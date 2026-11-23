"""Prepare and reconcile fresh public R2 generations for a current D1 snapshot."""
from __future__ import annotations

from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit
from uuid import uuid4

import taxonomy

HERE = Path(__file__).resolve().parent
FORMAT = "workshop-public-image-plan-v1"
WITHDRAWAL_FORMAT = "workshop-public-image-withdrawals-v1"
BUCKET = re.compile(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]")
ACCOUNT = re.compile(r"[a-f0-9]{32}")
UUID4 = r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
PUBLIC_KEY = re.compile(r"covers/(?:(?:gallery|banner)/)?" + UUID4)
BANNER_PATH = re.compile(r"/api/v1/(?:public-assets|assets)/banners/([A-Za-z0-9_.-]+)")
UPLOAD_MIMES = {"image/png", "image/jpeg", "image/webp"}
COVER_MIMES = UPLOAD_MIMES | {"image/gif", "image/avif"}
KINDS = {
    "cover": ("public_cover_replicas", "covers/", ("project_id",)),
    "gallery": ("public_gallery_replicas", "covers/gallery/", ("project_id", "kind", "asset_id")),
    "banner": ("public_banner_replicas", "covers/banner/", ("id", "source_url")),
}


class InputError(ValueError):
    pass


def normalized_origin(parts):
    port = parts.port
    if (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None
            or parts.netloc.endswith(":") or not re.fullmatch(r"[a-z0-9.-]+", parts.hostname)):
        return None
    default_port = 443 if parts.scheme == "https" else 80
    authority = parts.hostname if port in (None, default_port) else f"{parts.hostname}:{port}"
    return f"{parts.scheme}://{authority}"


def source_origin(origin):
    if not isinstance(origin, str) or re.search(r"[\x00-\x20\x7f\\?#]", origin):
        raise InputError("invalid historical Worker origin")
    parts = urlsplit(origin)
    normalized = normalized_origin(parts)
    if not normalized or parts.path not in ("", "/"):
        raise InputError("invalid historical Worker origin")
    return normalized


def banner_key(url, origin):
    if not isinstance(url, str) or re.search(r"[\x00-\x20\x7f\\?#]", url):
        return None
    if url.startswith("/"):
        path = url
    else:
        if not re.match(r"https?://", url, re.IGNORECASE):
            return None
        try:
            parts = urlsplit(url)
            if normalized_origin(parts) != origin:
                return None
        except ValueError:
            return None
        path = parts.path
    match = BANNER_PATH.fullmatch(path)
    return f"banners/{match[1]}" if match and match[1] not in (".", "..") else None


def eligible_images(db, origin):
    # Keep the cover selection aligned with data/public-covers.ts; in particular
    # a non-null explicit pointer never falls back to a published version cover.
    projects = """FROM projects p JOIN assets a ON a.project_id = p.id
        WHERE p.visibility = 'public' AND p.deleted_at IS NULL AND p.published_version_id IS NOT NULL"""
    for row in db.execute(f"""SELECT p.id, a.r2_key, a.bytes, a.sha256 {projects}
        AND a.kind = 'cover' AND ((a.id = p.published_cover_asset_id AND a.version_id IS NULL)
          OR (p.published_cover_asset_id IS NULL AND a.version_id = p.published_version_id)) ORDER BY p.id"""):
        yield "cover", [row[0]], row[1], row[2], row[3], None
    for row in db.execute(f"""SELECT p.id, a.kind, a.id, a.r2_key, a.bytes, a.sha256, a.mime {projects}
        AND a.kind IN ('gallery_1', 'gallery_2') AND a.version_id IS NULL ORDER BY p.id, a.kind"""):
        yield "gallery", [row[0], row[1], row[2]], row[3], row[4], row[5], row[6]
    row = db.execute("SELECT value FROM site_settings WHERE key = 'discover_banner'").fetchone()
    if row:
        try:
            setting = json.loads(row[0], object_pairs_hook=taxonomy.reject_duplicate_json_keys)
        except json.JSONDecodeError:
            return  # The Worker has no enabled banner for malformed JSON.
        url = setting.get("imageUrl") if isinstance(setting, dict) else None
        key = banner_key(url, origin)
        if key is not None:
            yield "banner", [1, url], key, None, None, None


def dimensions(private_bucket, public_bucket, account, origin):
    if not (isinstance(private_bucket, str) and BUCKET.fullmatch(private_bucket)
            and isinstance(public_bucket, str) and BUCKET.fullmatch(public_bucket)
            and isinstance(account, str) and ACCOUNT.fullmatch(account)):
        raise InputError("invalid snapshot private bucket, target public bucket or target account")
    if private_bucket == public_bucket or public_bucket.startswith("workshop-client-"):
        raise InputError("public target must be separate from private storage")
    return {"privateBucket": private_bucket, "publicBucket": public_bucket, "account": account,
            "sourceOrigin": source_origin(origin)}


def verify_sealed_plan(db, sealed_plan, source_hash, manifest, manifest_sha, canonical_pins, target_private_bucket):
    planner = taxonomy.module("public_image_planner", "multiday-plan.py")
    plan_file = sealed_plan.resolve()
    plan = planner.validate_plan(plan_file)
    receipt_rel = plan.get("expected", {}).get("byte_hash_receipt", "")
    receipt_file = (plan_file.parent / receipt_rel).resolve()
    expected_byte_sha = json.loads(receipt_file.read_text(encoding="utf-8")).get("sha256") if receipt_file.is_file() else None
    if (not isinstance(plan, dict) or expected_byte_sha != source_hash
            or plan.get("expected", {}).get("logical_sha256") != planner.rows_digest(db)):
        raise InputError("sealed plan does not match the candidate SQLite bytes")
    if plan.get("inputs", {}).get("manifest", {}).get("sha256") != manifest_sha:
        raise InputError("sealed plan manifest does not match the downloaded R2 manifest")
    plan_migs = [{"name": m["name"], "sha256": m["sha256"]} for m in plan.get("inputs", {}).get("migrations", [])]
    canon_migs = [{"name": m["name"], "sha256": m["sha256"]} for m in canonical_pins]
    if plan_migs != canon_migs:
        raise InputError("sealed plan migrations differ from canonical D1 migrations")
    source_sha = plan.get("inputs", {}).get("source", {}).get("sha256")
    paired_sources = [database for database in manifest["databases"] if database["sha256"] == source_sha]
    if len(paired_sources) != 1:
        raise InputError("sealed plan source must match exactly one D1 export in the downloaded R2 manifest")
    prep_file = plan_file.parent / "preparation.json"
    if not prep_file.is_file() or taxonomy.file_hash(prep_file) != plan.get("inputs", {}).get("preparation", {}).get("sha256"):
        raise InputError("sealed plan preparation.json is missing or altered")
    prep_data = json.loads(prep_file.read_bytes(), object_pairs_hook=taxonomy.reject_duplicate_json_keys)
    key_map = {
        entry["targetKey"]: entry["sourceKey"]
        for entry in prep_data.get("objects", [])
        if entry.get("sourceBucket") == target_private_bucket
    }
    return {"sealedPlanSha256": taxonomy.file_hash(plan_file)}, key_map


def load_prior_keys(prior_path, target, sources, key_map):
    prior_path = Path(prior_path).resolve()
    with prior_path.open("rb") as stream:
        is_sqlite = stream.read(16) == b"SQLite format 3\x00"
    reusable, seen_keys = {}, set()
    if is_sqlite:
        with taxonomy.snapshot(prior_path) as (prior_db, _):
            if not taxonomy.PUBLIC_REPLICAS <= taxonomy.table_names(prior_db):
                raise InputError("prior SQLite snapshot lacks public replica tables")
            cover_keys = {
                r[0]: r[1]
                for r in prior_db.execute("SELECT project_id, object_key FROM public_cover_replicas WHERE phase = 'ready'")
            }
            gallery_keys = {
                (r[0], r[1], r[2]): r[3]
                for r in prior_db.execute(
                    "SELECT project_id, kind, asset_id, object_key FROM public_gallery_replicas WHERE phase = 'ready'"
                )
            }
            banner_keys = {
                (r[0], r[1]): r[2]
                for r in prior_db.execute("SELECT id, source_url, object_key FROM public_banner_replicas WHERE phase = 'ready'")
            }
            for kind, identity, source_key, size, digest, asset_mime in eligible_images(prior_db, target["sourceOrigin"]):
                if kind == "cover":
                    target_key = cover_keys.get(identity[0])
                elif kind == "gallery":
                    target_key = gallery_keys.get((identity[0], identity[1], identity[2]))
                else:
                    target_key = banner_keys.get((identity[0], identity[1]))
                if target_key is None:
                    continue
                namespace = KINDS[kind][1]
                if not isinstance(target_key, str) or not re.fullmatch(namespace + UUID4, target_key) or target_key in seen_keys:
                    raise InputError("invalid or duplicate targetKey in prior SQLite snapshot")
                seen_keys.add(target_key)
                lookup_key = key_map.get(source_key, source_key)
                source = sources.get(lookup_key)
                if source is None:
                    continue
                if kind != "banner" and (
                    size != source["size"] or not isinstance(digest, str) or digest.lower() != source["sha256"].lower()
                ):
                    continue
                content_type = asset_mime if kind == "gallery" else (source.get("http_metadata") or {}).get("contentType")
                logical_key = tuple(identity[:2] if kind == "gallery" else identity[:1])
                reusable[(kind, logical_key, lookup_key, source["size"], source["sha256"].lower(), content_type)] = target_key
        return reusable

    prior_plan = taxonomy.read_review(prior_path)
    if (
        not isinstance(prior_plan, dict)
        or prior_plan.get("format") != FORMAT
        or prior_plan.get("publicBucket") != target["publicBucket"]
        or prior_plan.get("account") != target["account"]
        or not isinstance(prior_plan.get("objects"), list)
    ):
        raise InputError("prior plan does not match the target public bucket or account")
    for entry in prior_plan["objects"]:
        if not isinstance(entry, dict) or entry.get("kind") not in KINDS:
            raise InputError("invalid entry in prior public image plan")
        kind = entry["kind"]
        namespace = KINDS[kind][1]
        identity = entry.get("identity")
        target_key = entry.get("targetKey")
        source_key = entry.get("sourceKey")
        size = entry.get("bytes")
        sha = entry.get("sha256")
        content_type = entry.get("contentType")
        if (
            not isinstance(identity, list)
            or not identity
            or not isinstance(target_key, str)
            or not re.fullmatch(namespace + UUID4, target_key)
            or target_key in seen_keys
            or not isinstance(source_key, str)
            or isinstance(size, bool)
            or not isinstance(size, int)
            or not isinstance(sha, str)
            or not isinstance(content_type, str)
        ):
            raise InputError("invalid entry in prior public image plan")
        seen_keys.add(target_key)
        logical_key = tuple(identity[:2] if kind == "gallery" else identity[:1])
        reusable[(kind, logical_key, source_key, size, sha.lower(), content_type)] = target_key
    return reusable


def preparation(db, source_hash, verification, backup, migrations, target, previous=None, sealed_plan=None, prior_plan=None):
    if (verification is None) == (sealed_plan is None):
        raise InputError("supply exactly one of --candidate-verification or --sealed-plan")
    planner = taxonomy.module("public_image_planner", "multiday-plan.py")
    canonical, migration_pins = taxonomy.canonical(migrations)
    with closing(canonical):
        if not taxonomy.PUBLIC_REPLICAS <= taxonomy.table_names(db) or planner.schema(db) != planner.schema(canonical):
            raise InputError("candidate must use the complete canonical D1 schema")
    manifest_path = backup / "manifest.json"
    raw = manifest_path.read_bytes()
    manifest_sha = hashlib.sha256(raw).hexdigest()
    manifest = json.loads(raw, object_pairs_hook=taxonomy.reject_duplicate_json_keys)
    if verification is not None:
        report_raw = verification.read_bytes()
        report = json.loads(report_raw, object_pairs_hook=taxonomy.reject_duplicate_json_keys)
        if (report["format"] != "workshop-taxonomy-verification-v1" or report["ok"] is not True
                or report["candidateSha256"] != source_hash):
            raise InputError("taxonomy verification does not match the candidate SQLite bytes")
        paired_sources = [database for database in manifest["databases"]
                          if database["sha256"] == report["sourceSha256"]]
        if len(paired_sources) != 1:
            raise InputError("taxonomy source must match exactly one D1 export in the downloaded R2 manifest")
        provenance = {"verificationSha256": hashlib.sha256(report_raw).hexdigest()}
        key_map = {}
    else:
        provenance, key_map = verify_sealed_plan(
            db, sealed_plan, source_hash, manifest, manifest_sha, migration_pins, target["privateBucket"]
        )
    objects = manifest["buckets"][target["privateBucket"]]["objects"]
    sources = {obj["key"]: obj for obj in objects}
    if len(sources) != len(objects):
        raise InputError("duplicate private snapshot object")
    result = {"format": FORMAT, "d1Sha256": source_hash, "manifestSha256": manifest_sha,
              **provenance, "migrations": migration_pins, **target, "objects": []}
    if previous is not None and (not isinstance(previous["objects"], list)
                                 or any(not isinstance(entry, dict) for entry in previous["objects"])):
        raise InputError("invalid prepared image entries")
    reusable = load_prior_keys(prior_plan, target, sources, key_map) if (previous is None and prior_plan is not None) else {}
    prior = iter(previous["objects"] if previous is not None else [])
    keys, identities = set(), set()
    for kind, identity, source_key, size, digest, asset_mime in eligible_images(db, target["sourceOrigin"]):
        namespace = KINDS[kind][1]
        lookup_key = key_map.get(source_key, source_key)
        source = sources.get(lookup_key)
        if source is None:
            raise InputError("eligible image is absent from the downloaded private bucket")
        source_bytes, source_sha = source["size"], source["sha256"]
        if kind != "banner" and (size != source_bytes or not isinstance(digest, str)
                                 or digest.lower() != source_sha.lower()):
            raise InputError("eligible image disagrees with D1 size or hash")
        # Gallery follows the asset row's declared MIME, as in the Worker.
        # The private R2 contentType is authoritative for cover and banner.
        content_type = asset_mime if kind == "gallery" else (source.get("http_metadata") or {}).get("contentType")
        if content_type not in (COVER_MIMES if kind == "cover" else UPLOAD_MIMES):
            raise InputError(f"eligible {kind} does not have a supported image MIME")
        old = next(prior, {})
        logical_key = tuple(identity[:2] if kind == "gallery" else identity[:1])
        logical_id = (kind, logical_key)
        reuse_sig = (kind, logical_key, lookup_key, source_bytes, source_sha.lower(), content_type)
        if previous is not None:
            key = old.get("targetKey")
        elif reuse_sig in reusable:
            key = reusable[reuse_sig]
        else:
            key = namespace + str(uuid4())
        if (not isinstance(key, str) or not re.fullmatch(namespace + UUID4, key)
                or key in keys or logical_id in identities):
            raise InputError("invalid or duplicate public image generation")
        keys.add(key)
        identities.add(logical_id)
        result["objects"].append({"kind": kind, "identity": identity, "sourceBucket": target["privateBucket"],
                                  "sourceKey": lookup_key, "targetKey": key, "bytes": source_bytes,
                                  "sha256": source_sha, "contentType": content_type})
    if previous is not None and result != previous:
        raise InputError("prepared plan disagrees with the snapshot, schema or eligible images")
    return result


def transfer(mode, backup, plan):
    cmd = ["node", str(HERE / "full-r2.mjs"), f"public-{mode}"]
    if backup is not None:
        cmd.append(str(backup))
    result = subprocess.run(cmd, input=taxonomy.stable(plan), capture_output=True, text=True, check=False)
    if result.returncode:
        raise InputError(f"public R2 {mode} failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise InputError("unsupported replica column value")
    return str(value) if isinstance(value, int) else "'" + value.replace("'", "''") + "'"


def replicas_sql_text(plan, etags):
    lines = ["PRAGMA foreign_keys = ON;"]
    for table in sorted(taxonomy.PUBLIC_REPLICAS):
        lines.append(f"DELETE FROM {table};")
    for obj in plan["objects"]:
        table, _, columns = KINDS[obj["kind"]]
        key = obj["targetKey"]
        values = [sql_literal(v) for v in (*obj["identity"], key, "ready", etags[key])]
        lines.append(f"INSERT INTO {table} ({','.join(columns)},object_key,phase,reservation_etag) VALUES ({','.join(values)});")
    return "\n".join(lines) + "\n"


def write_ready(db, destination, plan, verified, replicas_sql=None):
    etags = verified["etags"]
    if (not isinstance(etags, dict) or etags.keys() != {obj["targetKey"] for obj in plan["objects"]}
            or any(not isinstance(tag, str) or not re.fullmatch(r'[\x21\x23-\x7e]+', tag) for tag in etags.values())):
        raise InputError("public destination verification did not return every object ETag")
    taxonomy.private_write(destination, b"")
    with closing(sqlite3.connect(destination)) as candidate:
        db.backup(candidate)
        candidate.execute("PRAGMA foreign_keys=ON")
        with candidate:
            for table in sorted(taxonomy.PUBLIC_REPLICAS):
                candidate.execute(f"DELETE FROM {table}")
            for obj in plan["objects"]:
                table, _, columns = KINDS[obj["kind"]]
                key = obj["targetKey"]
                placeholders = ",".join("?" for _ in columns)
                candidate.execute(f"INSERT INTO {table} ({','.join(columns)},object_key,phase,reservation_etag)"
                                  f" VALUES ({placeholders},?,'ready',?)", (*obj["identity"], key, etags[key]))
            if candidate.execute("PRAGMA foreign_key_check").fetchone():
                raise InputError("ready candidate failed D1 foreign-key reconciliation")
    if replicas_sql is not None:
        taxonomy.private_write(replicas_sql, replicas_sql_text(plan, etags).encode("utf-8"))


def withdraw_payload(args):
    doc = taxonomy.read_review(args.withdrawals)
    if not isinstance(doc, dict):
        raise InputError("invalid public withdrawal manifest")
    if doc.get("format") == WITHDRAWAL_FORMAT:
        raw_objects = doc.get("objects")
    elif doc.get("format") == "workshop-d1-delta-v1":
        raw_objects = doc.get("withdrawn_public_objects")
    else:
        raise InputError("unsupported public withdrawal manifest format")
    if not isinstance(raw_objects, list) or len(set(raw_objects)) != len(raw_objects):
        raise InputError("invalid or duplicate withdrawn object list")
    for key in raw_objects:
        if not isinstance(key, str) or not PUBLIC_KEY.fullmatch(key):
            raise InputError("invalid public replica key in withdrawal manifest")
    private_bucket = None
    if args.plan is not None:
        pinned = taxonomy.read_review(args.plan)
        if pinned.get("format") != FORMAT:
            raise InputError("invalid pinned public image plan")
        target = dimensions(pinned["privateBucket"], pinned["publicBucket"], pinned["account"], pinned["sourceOrigin"])
        public_bucket, private_bucket, account = target["publicBucket"], target["privateBucket"], target["account"]
        if args.target_public_bucket and args.target_public_bucket != public_bucket:
            raise InputError("--target-public-bucket disagrees with pinned plan")
        if args.target_account_id and args.target_account_id != account:
            raise InputError("--target-account-id disagrees with pinned plan")
    else:
        public_bucket = args.target_public_bucket
        account = args.target_account_id
        if not (isinstance(public_bucket, str) and BUCKET.fullmatch(public_bucket)
                and not public_bucket.startswith("workshop-client-")
                and isinstance(account, str) and ACCOUNT.fullmatch(account)):
            raise InputError("withdraw requires --plan or valid --target-public-bucket and --target-account-id")
    payload = {"format": WITHDRAWAL_FORMAT, "account": account, "publicBucket": public_bucket, "objects": raw_objects}
    if private_bucket is not None:
        payload["privateBucket"] = private_bucket
    return payload


def configure(parser):
    commands = parser.add_subparsers(dest="image_mode", required=True)
    for mode, help_text in (("prepare", "prepare a fresh image plan offline"),
                            ("upload", "conditionally create and verify objects in the pinned public bucket"),
                            ("finalize", "verify public objects and emit a new ready SQLite candidate")):
        command = commands.add_parser(mode, help=help_text)
        command.add_argument("--candidate", type=Path, required=True, help="verified canonical SQLite candidate")
        provenance = command.add_mutually_exclusive_group(required=True)
        provenance.add_argument("--candidate-verification", type=Path,
                                help="offline.py taxonomy verify --report for these exact SQLite bytes")
        provenance.add_argument("--sealed-plan", type=Path,
                                help="sealed legacy multiday plan.json matching these exact SQLite bytes")
        command.add_argument("--backup", type=Path, required=True, help="downloaded R2 mirror containing manifest.json")
        command.add_argument("--migrations", type=Path, required=True)
        command.add_argument("--plan", type=Path, required=True, help="private output for prepare; pinned input otherwise")
        if mode == "prepare":
            command.add_argument("--source-private-bucket", required=True)
            command.add_argument("--source-origin", required=True, help="verified Worker origin for historical absolute banner URLs")
            command.add_argument("--target-public-bucket", required=True)
            command.add_argument("--target-account-id", required=True)
            command.add_argument("--prior-plan", type=Path,
                                 help="optional Phase-1 public image plan JSON or ready SQLite snapshot to reuse unchanged keys")
        else:
            command.add_argument("--confirm-public-target", action="store_true", required=True,
                                 help="confirm separately authorized access to the public R2 target pinned in the plan")
        if mode == "finalize":
            command.add_argument("--output", type=Path, required=True, help="fresh ready SQLite file; never replaces existing files")
            command.add_argument("--replicas-sql", type=Path, help="optional private SQL file for importing ready replica rows")
    withdraw = commands.add_parser("withdraw", help="delete withdrawn public image objects and verify GET -> 404")
    withdraw.add_argument("--withdrawals", type=Path, required=True,
                          help="delta-withdrawals.json or delta.json from offline.py delta")
    withdraw.add_argument("--plan", type=Path, help="pinned workshop-public-image-plan-v1 JSON for target bucket/account")
    withdraw.add_argument("--target-public-bucket")
    withdraw.add_argument("--target-account-id")
    withdraw.add_argument("--confirm-public-target", action="store_true", required=True,
                          help="confirm separately authorized deletion on the target public bucket")


def run(args):
    try:
        if args.image_mode == "withdraw":
            payload = withdraw_payload(args)
            result = transfer("withdraw", None, payload)
            print(json.dumps({"ok": True, "mode": "withdraw", "targetPublicBucket": payload["publicBucket"], **result}))
            return 0
        manifest = args.backup / "manifest.json"
        if args.image_mode == "prepare":
            if args.plan.exists():
                raise InputError("plan already exists; select a fresh file")
            target = dimensions(args.source_private_bucket, args.target_public_bucket, args.target_account_id, args.source_origin)
            with taxonomy.snapshot(args.candidate) as (db, source_hash):
                plan = preparation(db, source_hash, args.candidate_verification, args.backup, args.migrations, target,
                                   sealed_plan=args.sealed_plan, prior_plan=args.prior_plan)
                result = transfer("check", args.backup, plan)
                if taxonomy.file_hash(manifest) != plan["manifestSha256"]:
                    raise InputError("downloaded manifest changed during verification")
            taxonomy.json_write(args.plan, plan)
        else:
            previous = taxonomy.read_review(args.plan)
            target = dimensions(previous["privateBucket"], previous["publicBucket"], previous["account"], previous["sourceOrigin"])
            if args.image_mode == "upload":
                with taxonomy.snapshot(args.candidate) as (db, source_hash):
                    plan = preparation(db, source_hash, args.candidate_verification, args.backup, args.migrations, target,
                                       previous, sealed_plan=args.sealed_plan)
                    result = transfer("upload", args.backup, plan)
            else:
                if args.output.exists() or (args.replicas_sql is not None and args.replicas_sql.exists()):
                    raise InputError("ready candidate or replicas SQL already exists; select a fresh file")
                with TemporaryDirectory(dir=args.output.parent, prefix=".public-images-") as directory:
                    ready = Path(directory) / "ready.sqlite"
                    sql_tmp = Path(directory) / "replicas.sql" if args.replicas_sql is not None else None
                    with taxonomy.snapshot(args.candidate) as (db, source_hash):
                        plan = preparation(db, source_hash, args.candidate_verification, args.backup, args.migrations, target,
                                           previous, sealed_plan=args.sealed_plan)
                        result = transfer("verify", args.backup, plan)
                        if taxonomy.file_hash(manifest) != plan["manifestSha256"]:
                            raise InputError("downloaded manifest changed during verification")
                        write_ready(db, ready, plan, result, replicas_sql=sql_tmp)
                    result["readySha256"] = taxonomy.file_hash(ready)
                    if sql_tmp is not None:
                        result["replicasSqlSha256"] = taxonomy.file_hash(sql_tmp)
                        os.link(sql_tmp, args.replicas_sql)
                    os.link(ready, args.output)
        result.pop("etags", None)
        print(json.dumps({"ok": True, "mode": args.image_mode, "targetPublicBucket": plan["publicBucket"], **result}))
        return 0
    except InputError as error:
        print(json.dumps({"ok": False, "error": str(error)}))
    except (OSError, ValueError, TypeError, KeyError, AttributeError, sqlite3.Error):
        print(json.dumps({"ok": False, "error": "invalid, stale or unreadable public image migration inputs"}))
    return 1

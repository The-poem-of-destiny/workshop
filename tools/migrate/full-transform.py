#!/usr/bin/env python3
"""Prepare a deterministic, offline legacy snapshot migration inventory.

Usage: python3 tools/migrate/full-transform.py DUMP.sql BACKUP-MANIFEST.json OUTPUT.json

DUMP is the complete legacy D1 SQL export, not an application database. The
manifest is the associated backup manifest. OUTPUT is sensitive: it contains
private project metadata and record-level diagnostic source values. This tool
never contacts Cloudflare, uploads, or modifies either input. It produces:
  inventory: all logical source tables and row counts;
  tables: candidate target rows, NOT an executable or verified migration;
  objects: {sourceBucket,sourceKey,targetKey,sha256,bytes} transfer plan;
  diagnostics: unresolved, record-level business-data issues.
  version_provenance: source row identity and snapshot metadata;
  omissions: source records or fields deliberately excluded from the snapshot.

A nonempty diagnostics list blocks loading. Even an empty list does not prove
content validity or authorization. Apply only after validating candidates and
R2 objects, reconciling permissions and counts, and agreeing on a load procedure.
Revision ordinals are synthetic and source creation timestamps do not establish
when a surviving snapshot arose. No approval or review history is invented.
Do not insert project counters and then let relationship triggers increment them
again: restore the reported counter values after inserting relationships. R2
keys under projects/ and covers/ are storage keys only; the caller must retain
existing per-project authorization and must not expose private
content by adding an object-serving route.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, urlparse

from full_transform_history import transform_history


DERIVED = {
    "d1_migrations", "sqlite_sequence", "_cf_KV", "project_search",
    "project_search_short", "project_search_tags", "public_project_counts",
    "project_period_popularity", "project_ranking_builds", "project_ranking_days",
    "project_rank_snapshots", "project_period_tracking_meta", "project_daily_rankings",
    "devteam_curators",
}
EPHEMERAL = {"download_daily_usage", "project_like_daily_usage", "repair_resolve_daily_usage"}
EXCLUDED = {"daily_random_draw_state", "admins", "super_admins", "character_references",
            "character_reference_versions", "character_reference_items"}
MISSING_DRAFTS = {"6497309b-990f-486c-ae32-06b675226e6e", "726d5157-9716-4863-9175-732bf8469dcf"}
MAPPED = {
    "users", "projects", "project_likes", "project_subscribes", "project_ratings",
    "project_metric_daily", "site_settings", "devteam_recommendations",
    "admin_action_logs", "project_metadata_audit_logs", "discovery_feature_history",
}
REQUIRED = MAPPED | {"admins", "super_admins", "admin_action_logs", "project_metadata_audit_logs"}


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def identifier(prefix, *parts):
    return prefix + "-" + hashlib.sha256(stable(parts).encode()).hexdigest()


def url_key(value):
    if not value:
        return None
    parsed = urlparse(value)
    path = unquote(parsed.path)
    if "/api/files/" in path:
        path = path.split("/api/files/", 1)[1]
    elif parsed.scheme or parsed.netloc:
        return None
    path = path.lstrip("/")
    return path if path and ".." not in path.split("/") else None


def project_tags(row):
    """Merge legacy keyword and facet values into the current flat tag list.

    The flat list cannot represent facet groups or a separate display selection;
    those source fields remain diagnostics even when their values are included.
    """
    unresolved = set()

    def parse(field, empty, expected):
        raw = row.get(field)
        if raw in (None, ""):
            return empty
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            unresolved.add(field)
            return None
        if not isinstance(value, expected):
            unresolved.add(field)
            return None
        return value

    tags = parse("tags", [], list)
    custom = parse("custom_tags", [], list)
    facets = parse("facets", {}, dict)
    if tags is None or any(not isinstance(tag, str) or not tag.strip() for tag in tags):
        unresolved.add("tags")
        return row.get("tags") or "[]", unresolved
    merged = list(dict.fromkeys(tags))
    if custom is not None:
        if any(not isinstance(tag, str) or not tag.strip() for tag in custom):
            unresolved.add("custom_tags")
        else:
            merged.extend(tag for tag in dict.fromkeys(custom) if tag not in merged)
    if facets:
        if all(isinstance(values, list) and all(isinstance(tag, str) and tag.strip() for tag in values)
               for values in facets.values()):
            for values in facets.values():
                merged.extend(tag for tag in dict.fromkeys(values) if tag not in merged)
        else:
            unresolved.add("facets")
    if len(merged) > 20:
        unresolved.add("tags exceeds current editor limit")
    return stable(merged), unresolved


def main():
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    dump, manifest_path, output = map(Path, sys.argv[1:])
    if output.resolve() in (dump.resolve(), manifest_path.resolve()):
        raise ValueError("output must not overwrite an input")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dump_bytes = dump.read_bytes()
    databases = [entry for entry in manifest.get("databases", []) if entry.get("name") == "creative_workshop"]
    if len(databases) != 1 or hashlib.sha256(dump_bytes).hexdigest() != databases[0].get("sha256"):
        raise ValueError("source SQL does not match the legacy database in the backup manifest")
    db = sqlite3.connect(":memory:")
    db.executescript(dump_bytes.decode("utf-8"))
    db.row_factory = sqlite3.Row
    names = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    # SQLite's FTS shadow tables are implementation detail, not source entities.
    names = [n for n in names if not any(n.startswith(p + "_") and n[len(p) + 1:] in
             {"config", "content", "data", "docsize", "idx"} for p in ("project_search", "project_search_short"))]
    missing = sorted(REQUIRED - set(names))
    if missing:
        raise ValueError("missing source tables: " + ", ".join(missing))
    source = {name: sorted((dict(row) for row in db.execute('SELECT * FROM "' + name.replace('"', '""') + '"')), key=stable)
              for name in names}
    db.close()
    tables = defaultdict(list)
    for name in ("users", "projects", "project_versions", "project_likes", "project_subscriptions",
                 "project_ratings", "project_metrics_daily", "audit_events", "recommendations", "assets",
                 "version_entry_index", "site_settings"):
        tables[name] = []
    issues = []

    omissions = []
    def issue(table, row, reason):
        issues.append({"table": table, "reason": reason, "source": row})

    def omit(table, row, reason):
        omissions.append({"table": table, "reason": reason, "source": row})

    for name, expected in databases[0].get("table_counts", {}).items():
        if name not in source or len(source[name]) != expected:
            issue(name, {"expected": expected, "actual": len(source[name]) if name in source else None},
                  "backup table count does not match manifest")

    inventory = []
    for name in names:
        category = ("mapped" if name in MAPPED else "derived" if name in DERIVED else
                    "ephemeral" if name in EPHEMERAL else "excluded" if name in EXCLUDED else "unmapped")
        inventory.append({"table": name, "rows": len(source[name]), "classification": category})
        if category == "excluded":
            for row in source[name]:
                omit(name, row, "daily draw excluded from migration" if name == "daily_random_draw_state"
                     else "reference baseline feature removed (R-18); source backup retained" if name.startswith("character_reference")
                     else "legacy privileges not migrated")
        if category == "unmapped":
            for row in source[name]:
                issue(name, row, "source business record has no established target mapping")

    users = {}
    privileged = {str(row["user_id"]) for name in ("admins", "super_admins") for row in source[name]}
    for row in source["users"]:
        uid = str(row["id"])
        if not row.get("username") or not row.get("created_at") or not row.get("updated_at"):
            issue("users", row, "missing required identity fields")
            continue
        users[uid] = row
        tables["users"].append({"id": uid, "username": row["username"], "global_name": row.get("global_name"),
                                "avatar": row.get("avatar"), "role": "member", "created_at": row["created_at"],
                                "updated_at": row["updated_at"]})
        if uid in privileged or row.get("is_admin"):
            omit("users", {"id": uid}, "legacy privileges not migrated")

    projects = {str(row["id"]): row for row in source["projects"]}
    roots = {}
    for pid, row in projects.items():
        root = str(row.get("root_project_id") or pid)
        if root not in projects or str(projects[root].get("root_project_id") or root) != root:
            issue("projects", row, "missing or inconsistent root project")
            continue
        roots[pid] = root
    groups = defaultdict(list)
    for pid, root in roots.items():
        groups[root].append(projects[pid])


    excluded_roots = {root for root in groups if str(projects[root].get("draft_project_id")) in MISSING_DRAFTS}
    for root in excluded_roots:
        for row in groups[root]:
            omit("projects", row, "excluded project with known missing draft")
    manifest_objects = {}
    for bucket, info in sorted(manifest.get("buckets", {}).items()):
        for obj in info.get("objects", []):
            key = (bucket, obj["key"])
            if key in manifest_objects:
                raise ValueError("duplicate source object in backup manifest: " + stable(key))
            manifest_objects[key] = obj
    used_objects = set()
    planned_targets = {}
    objects = []
    content_requests = []
    revision_sources = {}
    revision_incomplete = set()
    empty_worldbooks = set()

    def plan(bucket, key, target):
        obj = manifest_objects[(bucket, key)]
        if not obj.get("sha256") or obj.get("size") is None:
            issue("r2", {"bucket": bucket, "key": key}, "backup lacks object hash or size")
            return None
        previous = planned_targets.get(target)
        if previous is not None and previous != (obj["sha256"], obj["size"]):
            issue("r2", {"bucket": bucket, "key": key, "target": target}, "target key collision")
            return None
        if previous is None:
            objects.append({"sourceBucket": bucket, "sourceKey": key, "targetKey": target,
                            "sha256": obj["sha256"], "bytes": obj["size"]})
            planned_targets[target] = (obj["sha256"], obj["size"])
        used_objects.add((bucket, key))
        return obj

    revision_by_source = {}
    accepted_roots = set()
    version_provenance = []
    for root, versions in sorted(groups.items()):
        if root in excluded_roots:
            continue
        base = projects[root]
        if str(base["author_id"]) not in users or not base.get("name") or not base.get("created_at") or not base.get("updated_at"):
            issue("projects", base, "missing author or required project fields")
            continue
        published_id = base.get("published_project_id") or (root if base.get("is_published") else None)
        draft_id = base.get("draft_project_id") or root
        selected_ids = {str(draft_id)}
        if published_id:
            selected_ids.add(str(published_id))
        if roots.get(str(draft_id)) != root or (published_id and roots.get(str(published_id)) != root):
            issue("projects", base, "draft or published project pointer is unresolved")
            continue
        ordered = sorted((v for v in versions if str(v["id"]) in selected_ids),
                         key=lambda v: (str(v["id"]) != root, str(v["id"])))
        if any(str(v["author_id"]) != str(base["author_id"]) for v in ordered):
            issue("projects", base, "project versions have different authors")
            continue
        for v in versions:
            if str(v["id"]) not in selected_ids:
                omit("projects", v, "historical revision outside current snapshot")
        for v in ordered:
            revision_by_source[str(v["id"])] = identifier("legacy-revision", str(v["id"]))
        pub = projects[str(published_id)] if published_id else None
        if pub and (pub.get("status") != "approved" or not pub.get("is_published")):
            issue("projects", pub, "published pointer does not identify an approved published record")
            continue
        accepted_roots.add(root)
        current = projects[str(draft_id)]
        projection = pub if pub is not None else current
        visible = bool(pub and pub.get("visibility") == 1)
        published_at = (pub.get("latest_approved_at") or pub.get("reviewed_at")) if pub else None
        if pub and not published_at:
            issue("projects", pub, "published timestamp is not present in source")
        mapped_tags = {str(v["id"]): project_tags(v) for v in ordered}
        def common(v):
            return {"title": v["name"], "description": v.get("description"), "author_note": None,
                    "project_type": v.get("project_type"), "extension_type": v.get("extension_type"),
                    "version_label": v.get("version_label") or v.get("version"),
                    "requirements": stable({"schemaVersion": 1, "dependencies": [], "conflicts": [], "notes": v["precautions"]}) if v.get("precautions") is not None else None,
                    "cover_position_x": v.get("cover_position_x"), "cover_position_y": v.get("cover_position_y"),
                    "cover_zoom": v.get("cover_zoom")}
        tables["projects"].append({"id": root, "author_id": str(base["author_id"]),
            "visibility": "public" if visible else "private",
            "working_version_id": revision_by_source[str(draft_id)],
            "published_version_id": revision_by_source[str(published_id)] if pub else None,
            "published_at": published_at, "downloads_count": base.get("downloads_count") or 0,
            "likes_count": base.get("likes_count") or 0, "subscriptions_count": 0,
            "created_at": base["created_at"], "updated_at": base["updated_at"]})
        for number, v in enumerate(ordered, 1):
            vid = str(v["id"])
            rid = revision_by_source[vid]
            tables["project_versions"].append({"id": rid, "project_id": root, "version_no": number,
                **common(v), "tags": mapped_tags[vid][0], "discord_thread_url": v.get("discord_thread_url"),
                "created_by": str(v["author_id"]), "created_at": v.get("created_at"), "entry_index_ready": 0})
            version_provenance.append({"version_id": rid, "source_project_id": vid,
                "source_root_project_id": root, "source_created_at": v.get("created_at"),
                "source_updated_at": v.get("updated_at"), "source_reviewed_at": v.get("reviewed_at"),
                "source_latest_approved_at": v.get("latest_approved_at"),
                "source_status": v.get("status"), "source_accepted_code_check": v.get("accepted_code_check"),
                "source_published_project_id": v.get("published_project_id"),
                "source_draft_project_id": v.get("draft_project_id"),
                "version_no_is_synthetic": True, "snapshot_creation_time_known": False})
            revision_sources[rid] = v
            history_fields = ("reviewed_at", "reviewer_id", "reject_reason", "accepted_code_check")
            if any(v.get(field) for field in history_fields) or v.get("status") not in ("approved", None):
                omit("projects", {"id": vid}, "legacy submission/review/check history not reconstructed")
            legacy_fields = ("facets", "display_tags", "character_reference_id",
                "built_for_reference_version_id", "tested_through_reference_version_id", "compatibility_status",
                "compatibility_known_incompatible", "compatibility_note", "compatibility_grace_until",
                "compatibility_updated_at", "conflicts_with_original", "original_conflict_reference_item_ids",
                "worldbook_ejs_length_estimates", "original_conflict_entry_names", "has_ejs", "has_character_artwork")
            if mapped_tags[vid][1]:
                issue("projects", v, "legacy tags cannot be represented unambiguously")
            omitted_fields = {field: v[field] for field in legacy_fields
                              if v.get(field) not in (None, "", 0, "[]", "{}")}
            if omitted_fields:
                omit("projects", {"id": vid, "fields": omitted_fields}, "legacy metadata has no snapshot mapping")
            refs = [("worldbook", url_key(v.get("download_url"))), ("cover", url_key(v.get("cover_image"))),
                    ("regex", f"projects/{vid}/regex-{vid}.json")]
            for kind, key in refs:
                if not key:
                    if kind != "regex" and v.get("download_url" if kind == "worldbook" else "cover_image"):
                        issue("projects", v, "unrecognized " + kind + " asset URL")
                        revision_incomplete.add(rid)
                    continue
                candidates = [(b, key) for b in ("creative-workshop-projects", "creative-workshop-uploads") if (b, key) in manifest_objects]
                if len(candidates) != 1:
                    if kind != "regex" or candidates:
                        issue("projects", v, "missing or ambiguous " + kind + " backup object: " + key)
                        revision_incomplete.add(rid)
                    continue
                bucket, key = candidates[0]
                obj = manifest_objects[(bucket, key)]
                if kind == "worldbook" and obj.get("size") == 0:
                    omit("r2", {"bucket": bucket, "key": key}, "zero-byte worldbook omitted")
                    empty_worldbooks.add(rid)
                    continue
                sha = obj.get("sha256")
                target = ("covers/imported/" if kind == "cover" else "projects/imported/") + str(sha)
                if not plan(bucket, key, target):
                    revision_incomplete.add(rid)
                    continue
                tables["assets"].append({"id": identifier("legacy-asset", rid, kind), "project_id": root,
                    "version_id": rid, "kind": kind, "r2_key": target, "sha256": sha, "bytes": obj["size"],
                    "mime": (obj.get("http_metadata") or {}).get("contentType") or
                            ("application/json" if kind != "cover" else "application/octet-stream"),
                    "created_at": v.get("created_at")})
                backup_path = (manifest_path.parent / obj.get("local_path", "")).resolve()
                if not backup_path.is_relative_to(manifest_path.parent.resolve()):
                    issue("r2", {"bucket": bucket, "key": key}, "backup object path escapes backup directory")
                    revision_incomplete.add(rid)
                    continue
                content_requests.append({"id": identifier("legacy-asset", rid, kind), "path": str(backup_path),
                                         "kind": kind, "sha256": sha, "bytes": obj["size"]})

    if content_requests:
        helper = Path(__file__).with_name("full-transform-content.mjs")
        completed = subprocess.run(["node", "--experimental-strip-types", str(helper)], input=stable(content_requests), text=True,
                                   capture_output=True, check=True)
        validations = {item["id"]: item for item in json.loads(completed.stdout)}
        if set(validations) != {item["id"] for item in content_requests}:
            raise ValueError("content validation did not return exactly one result per asset")
        valid_regex = {(asset["version_id"], asset["sha256"], asset["bytes"])
                       for asset in tables["assets"] if asset["kind"] == "regex"
                       and asset["id"] in validations and not validations[asset["id"]].get("error")}
        valid_content = {asset["version_id"] for asset in tables["assets"]
                         if asset["kind"] in ("worldbook", "regex") and asset["id"] in validations
                         and not validations[asset["id"]].get("error")}
        private_projects = {project["id"] for project in tables["projects"] if project["visibility"] == "private"}
        kept_assets = []
        for asset in tables["assets"]:
            validation = validations.get(asset["id"])
            if validation is None or validation.get("error"):
                if (validation and asset["kind"] == "worldbook"
                        and validation.get("error") == "检测到正则 JSON，请上传到正则文件"
                        and (asset["version_id"], asset["sha256"], asset["bytes"]) in valid_regex):
                    omit("projects", {"id": revision_sources[asset["version_id"]]["id"],
                                      "sha256": asset["sha256"]},
                         "worldbook duplicates validated regex asset")
                    continue
                if validation and validation.get("stage") == "content" and asset["kind"] in ("worldbook", "regex"):
                    asset_source = {"id": revision_sources[asset["version_id"]]["id"],
                                    "kind": asset["kind"], "sha256": asset["sha256"]}
                    if validation["error"] == "duplicate entry keys":
                        kept_assets.append(asset)
                        revision_incomplete.add(asset["version_id"])
                        omit("projects", asset_source, "content index unavailable: duplicate entry keys")
                        continue
                    if asset["version_id"] in valid_content:
                        omit("projects", asset_source, "invalid content asset omitted: " + validation["error"])
                        continue
                    if asset["project_id"] in private_projects:
                        revision_incomplete.add(asset["version_id"])
                        omit("projects", asset_source, "invalid content asset omitted: " + validation["error"])
                        continue
                issue("projects", revision_sources[asset["version_id"]],
                      "asset validation failed: " + (validation.get("error", "not validated") if validation else "not validated"))
                revision_incomplete.add(asset["version_id"])
                continue
            kept_assets.append(asset)
            for entry in validation["entries"]:
                tables["version_entry_index"].append({"version_id": asset["version_id"], **entry})
        tables["assets"] = kept_assets
        retained_targets = {asset["r2_key"] for asset in kept_assets}
        objects = [obj for obj in objects if obj["targetKey"] in retained_targets]
        tables["version_entry_index"] = [entry for entry in tables["version_entry_index"]
                                           if entry["version_id"] not in revision_incomplete]
        assets_by_revision = defaultdict(list)
        for asset in kept_assets:
            assets_by_revision[asset["version_id"]].append(asset)
        index_counts = Counter((entry["version_id"], entry["kind"]) for entry in tables["version_entry_index"])
        for revision in tables["project_versions"]:
            rid = revision["id"]
            assets = assets_by_revision[rid]
            content = [asset for asset in assets if asset["kind"] in ("worldbook", "regex")]
            if not content and rid not in empty_worldbooks and rid not in revision_incomplete:
                omit("projects", {"id": revision_sources[rid]["id"]}, "source revision has no content asset")
            revision["worldbook_count"] = index_counts[(rid, "worldbook")]
            revision["regex_count"] = index_counts[(rid, "regex")]
            if rid not in revision_incomplete:
                revision["entry_index_ready"] = 1
                hashes = "\n".join(asset["kind"] + ":" + asset["sha256"] for asset in
                                   sorted(assets, key=lambda asset: (asset["kind"], asset["r2_key"])))
                revision["manifest_hash"] = hashlib.sha256(hashes.encode()).hexdigest()
    else:
        for revision in tables["project_versions"]:
            if revision["id"] not in empty_worldbooks and revision["id"] not in revision_incomplete:
                omit("projects", {"id": revision_sources[revision["id"]]["id"]}, "source revision has no content asset")
            if revision["id"] not in revision_incomplete:
                revision["worldbook_count"] = 0
                revision["regex_count"] = 0
                revision["entry_index_ready"] = 1
                revision["manifest_hash"] = hashlib.sha256(b"").hexdigest()

    relations = (("project_likes", "project_likes"), ("project_subscribes", "project_subscriptions"),
                 ("project_ratings", "project_ratings"), ("project_metric_daily", "project_metrics_daily"))
    for source_name, target_name in relations:
        seen = set()
        for row in source[source_name]:
            root = roots.get(str(row["project_id"]))
            if root in excluded_roots:
                omit(source_name, row, "relation belongs to excluded project")
                continue
            if root not in accepted_roots or ("user_id" in row and str(row["user_id"]) not in users):
                issue(source_name, row, "missing mapped project or user")
                continue
            if str(row["project_id"]) != root and str(row["project_id"]) not in revision_by_source:
                omit(source_name, row, "relation belongs to omitted historical revision")
                continue
            mapped = {**row, "project_id": root}
            key = (root, row.get("user_id", row.get("day_key")))
            if key in seen:
                issue(source_name, row, "multiple source records collapse to the same target key")
                continue
            seen.add(key)
            tables[target_name].append(mapped)
    subscriptions = Counter(row["project_id"] for row in tables["project_subscriptions"])
    likes = Counter(row["project_id"] for row in tables["project_likes"])
    for row in tables["projects"]:
        row["subscriptions_count"] = subscriptions[row["id"]]
        if row["likes_count"] != likes[row["id"]]:
            issue("projects", projects[row["id"]], "legacy likes count differs from mapped active likes")
    for name, target, rename in (
        ("site_settings", "site_settings", {}),
    ):
        for row in source[name]:
            mapped = {rename.get(k, k): v for k, v in row.items()}
            for field in ("created_by", "updated_by"):
                if mapped.get(field) is not None and str(mapped[field]) not in users:
                    issue(name, row, "referenced user is missing: " + field)
            tables[target].append(mapped)
    transform_history(source, tables, issue, omit, roots, accepted_roots, excluded_roots, users, identifier)
    indexes = defaultdict(list)
    for entry in tables.pop("version_entry_index"):
        indexes[entry["version_id"]].append({"kind": entry["kind"], "entryKey": entry["entry_key"],
            "name": entry["name"], "contentHash": entry["content_hash"], "contentLength": entry["content_length"]})
    for version in tables["project_versions"]:
        ready = version.pop("entry_index_ready")
        version["entry_index"] = stable({"schemaVersion": 1, "entries": sorted(indexes[version["id"]], key=lambda e: (e["kind"], e["entryKey"]))}) if ready else None
    result = {"format": "workshop-full-migration-preparation-v1", "inventory": inventory,
              "tables": {name: sorted(rows, key=stable) for name, rows in sorted(tables.items())},
              "version_provenance": sorted(version_provenance, key=lambda row: row["version_id"]),
              "objects": sorted(objects, key=lambda row: (row["targetKey"], row["sourceBucket"], row["sourceKey"])),
              "omissions": sorted(omissions, key=stable),
              "diagnostics": sorted(issues, key=stable)}
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump(result, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write("\n")
    print("prepared", len(inventory), "source tables,", len(issues), "blocking diagnostics")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

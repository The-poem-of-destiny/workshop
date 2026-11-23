#!/usr/bin/env python3
"""Behavioral tests for two-phase cutover delta, public image key reuse/withdrawal, and bound preload recovery."""
from __future__ import annotations

from contextlib import closing, redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
MIGRATIONS = HERE.parents[1] / "apps/worker/migrations"
sys.path.insert(0, str(HERE))

import bound_preload
import d1_delta
import offline
import public_images
import taxonomy


def load_mod(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


planner = load_mod("multiday-plan")
staging = load_mod("multiday-staging")

PNG_1 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-fixture-one"
PNG_2 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-fixture-two"
PNG_3 = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-fixture-three"
BANNER_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR-banner"


def create_canonical_db(path: Path) -> sqlite3.Connection:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    db = sqlite3.connect(path)
    for mig in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(mig.read_text(encoding="utf-8"))
    db.execute("PRAGMA foreign_keys = ON")
    return db


def seed_base_project(db: sqlite3.Connection):
    entry_idx = json.dumps({"schemaVersion": 1, "entries": []})
    empty_hash = hashlib.sha256(b"").hexdigest()
    db.execute("INSERT INTO users (id, username, global_name, role) VALUES ('u1', 'alice', 'Alice', 'owner')")
    db.execute("INSERT INTO users (id, username, global_name, role) VALUES ('u2', 'bob', 'Bob', 'member')")
    db.execute("INSERT INTO projects (id, author_id, visibility) VALUES ('p1', 'u1', 'public')")
    db.execute(
        """INSERT INTO project_versions
           (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash, created_by, entry_index)
           VALUES ('v1', 'p1', 1, 'AlphaCard', 'Initial release', '角色', '[]', '["奇幻"]', ?, 'u1', ?)""",
        (empty_hash, entry_idx),
    )
    db.execute(
        """INSERT INTO project_versions
           (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash, created_by, entry_index)
           VALUES ('v2', 'p1', 2, 'AlphaCard v2', 'Candidate draft', '角色', '[]', '["奇幻","冒险"]', ?, 'u1', ?)""",
        (empty_hash, entry_idx),
    )
    db.execute(
        "UPDATE projects SET working_version_id = 'v2', published_version_id = 'v1', published_at = '2026-10-01T00:00:00.000Z' WHERE id = 'p1'"
    )
    db.commit()


class CutoverDeltaTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)

    def apply_batches_and_assert(self, from_db: Path, to_db: Path, delta_dir: Path, manifest: dict):
        self.assertLessEqual(manifest["bytes"], 10_000_000)
        replayed = self.root / f"replayed-{delta_dir.name}.sqlite"
        with closing(sqlite3.connect(from_db)) as src, closing(sqlite3.connect(replayed)) as target:
            src.backup(target)
            target.execute("PRAGMA foreign_keys = ON")
            for batch in manifest["batches"]:
                batch_path = delta_dir / batch["file"]
                raw = batch_path.read_bytes()
                self.assertLessEqual(len(raw), d1_delta.BATCH_BYTES)
                text = batch_path.read_text(encoding="utf-8")
                stmts = planner.statements(text)
                for stmt in stmts:
                    self.assertLessEqual(len(stmt.encode("utf-8")), d1_delta.STATEMENT_BYTES)
                target.executescript("BEGIN;\n" + text + "COMMIT;")
                self.assertEqual(target.execute("PRAGMA foreign_key_check").fetchall(), [])
            with closing(sqlite3.connect(to_db)) as expected:
                self.assertEqual(planner.schema(target), planner.schema(expected))
                self.assertEqual(planner.rows_digest(target), planner.rows_digest(expected))
                self.assertTrue(all(staging.compare_search(expected, target).values()))
        return replayed

    def test_pending_to_approved_and_new_pending_submission_plus_secondary_unique_swaps(self):
        phase1 = self.root / "phase1.sqlite"
        phase2 = self.root / "phase2.sqlite"
        with closing(create_canonical_db(phase1)) as db:
            seed_base_project(db)
            db.execute(
                "INSERT INTO submissions (id, project_id, version_id, status, submitted_by, base_published_version_id) "
                "VALUES ('s1', 'p1', 'v2', 'pending', 'u1', 'v1')"
            )
            db.execute(
                "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) "
                "VALUES ('g1', 'p1', NULL, 'gallery_1', 'gallery/p1/g1.png', ?, 10, 'image/png')",
                ("a" * 64,),
            )
            db.execute(
                "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) "
                "VALUES ('g2', 'p1', NULL, 'gallery_2', 'gallery/p1/g2.png', ?, 10, 'image/png')",
                ("b" * 64,),
            )
            db.commit()

        with closing(sqlite3.connect(phase1)) as src, closing(sqlite3.connect(phase2)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA foreign_keys = ON")
            # s1 transitions pending -> approved; v3 created and s2 inserted as new pending!
            dst.execute("UPDATE submissions SET status = 'approved', resolved_at = '2026-10-02T00:00:00.000Z' WHERE id = 's1'")
            entry_idx = json.dumps({"schemaVersion": 1, "entries": []})
            empty_hash = hashlib.sha256(b"").hexdigest()
            dst.execute(
                """INSERT INTO project_versions
                   (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash, created_by, entry_index)
                   VALUES ('v3', 'p1', 3, 'AlphaCard v3', 'Next pending', '角色', '[]', '["冒险"]', ?, 'u1', ?)""",
                (empty_hash, entry_idx),
            )
            dst.execute("UPDATE projects SET published_version_id = 'v2', working_version_id = 'v3' WHERE id = 'p1'")
            dst.execute(
                "INSERT INTO submissions (id, project_id, version_id, status, submitted_by, base_published_version_id) "
                "VALUES ('s2', 'p1', 'v3', 'pending', 'u1', 'v2')"
            )
            # Also swap gallery_1 <-> gallery_2 on surviving assets and swap version_no 1 <-> 2!
            dst.execute("DELETE FROM assets WHERE id IN ('g1', 'g2')")
            dst.execute(
                "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) "
                "VALUES ('g1', 'p1', NULL, 'gallery_2', 'gallery/p1/g1.png', ?, 10, 'image/png')",
                ("a" * 64,),
            )
            dst.execute(
                "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) "
                "VALUES ('g2', 'p1', NULL, 'gallery_1', 'gallery/p1/g2.png', ?, 10, 'image/png')",
                ("b" * 64,),
            )
            dst.execute("UPDATE project_versions SET version_no = -99 WHERE id = 'v1'")
            dst.execute("UPDATE project_versions SET version_no = 1 WHERE id = 'v2'")
            dst.execute("UPDATE project_versions SET version_no = 2 WHERE id = 'v1'")
            dst.commit()

        delta_dir = self.root / "delta-unique"
        manifest = d1_delta.build_delta(phase1, phase2, delta_dir)
        replayed = self.apply_batches_and_assert(phase1, phase2, delta_dir, manifest)
        with closing(sqlite3.connect(replayed)) as check_db:
            rows = check_db.execute("SELECT id, status FROM submissions ORDER BY id").fetchall()
            self.assertEqual(rows, [("s1", "approved"), ("s2", "pending")])

    def test_nul_bytes_carriage_returns_and_large_chunked_entry_index(self):
        phase1 = self.root / "nul-phase1.sqlite"
        phase2 = self.root / "nul-phase2.sqlite"
        with closing(create_canonical_db(phase1)) as db:
            seed_base_project(db)

        # Build a valid ~490 KB entry_index JSON (> 980 KB in hex, testing both > 64 KB statements
        # and > 1,000,000-byte multi-batch splitting while satisfying CHECK(json_valid(entry_index) <= 512000)).
        entries = [
            {"kind": "worldbook", "entryKey": f"entry-{i:04d}", "name": f"Lore chapter {i} " + ("x" * 190)}
            for i in range(1850)
        ]
        large_index = json.dumps({"schemaVersion": 1, "entries": entries}, separators=(",", ":"))
        self.assertGreater(len(large_index.encode("utf-8")), 450_000)
        self.assertLessEqual(len(large_index.encode("utf-8")), 512_000)

        nul_comment = "before-nul\x00middle\r\nafter-'quote'-nul\x00end"
        with closing(sqlite3.connect(phase1)) as src, closing(sqlite3.connect(phase2)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA foreign_keys = ON")
            # Update existing v1 with ~490 KB entry_index and NUL+CR description
            dst.execute(
                "UPDATE project_versions SET entry_index = ?, description = ?, cover_zoom = 1.25 WHERE id = 'v1'",
                (large_index, nul_comment),
            )
            # Also insert brand-new v3 with ~490 KB entry_index and unversioned note containing NUL
            dst.execute(
                """INSERT INTO project_versions
                   (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash, created_by, entry_index)
                   VALUES ('v3', 'p1', 3, 'LargeInserted', ?, '角色', '[]', '["奇幻"]', ?, 'u1', ?)""",
                (nul_comment, hashlib.sha256(b"v3").hexdigest(), large_index),
            )
            dst.execute(
                "INSERT INTO project_unversioned_notes (project_id, user_id, rating, comment_text) VALUES ('p1', 'u2', 5, ?)",
                (nul_comment,),
            )
            dst.commit()

        delta_dir = self.root / "delta-large"
        manifest = d1_delta.build_delta(phase1, phase2, delta_dir)
        self.assertGreaterEqual(manifest["batch_count"], 2)
        replayed = self.apply_batches_and_assert(phase1, phase2, delta_dir, manifest)
        with closing(sqlite3.connect(replayed)) as check_db:
            v1_desc, v1_idx = check_db.execute(
                "SELECT description, entry_index FROM project_versions WHERE id = 'v1'"
            ).fetchone()
            v3_desc, v3_idx = check_db.execute(
                "SELECT description, entry_index FROM project_versions WHERE id = 'v3'"
            ).fetchone()
            note_text, = check_db.execute(
                "SELECT comment_text FROM project_unversioned_notes WHERE project_id = 'p1' AND user_id = 'u2'"
            ).fetchone()
            self.assertEqual(v1_desc, nul_comment)
            self.assertEqual(v3_desc, nul_comment)
            self.assertEqual(note_text, nul_comment)
            self.assertEqual(v1_idx, large_index)
            self.assertEqual(v3_idx, large_index)
            self.assertEqual(
                check_db.execute("SELECT name FROM sqlite_schema WHERE name LIKE '_workshop_%'").fetchall(), []
            )


class PublicImageReuseAndWithdrawTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.account = "a" * 32
        self.priv_bucket = "workshop-client-prod"
        self.pub_bucket = "workshop-img-prod"
        self.origin = "https://workshop.example.com"

    def write_backup_and_verification(self, candidate_path: Path, objects_spec: dict[str, tuple[bytes, str]], tag: str):
        backup = self.root / f"backup-{tag}"
        r2_dir = backup / "r2" / self.priv_bucket
        r2_dir.mkdir(parents=True)
        manifest_objs = []
        for key, (payload, mime) in sorted(objects_spec.items()):
            file_path = r2_dir / key
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(payload)
            manifest_objs.append({
                "key": key,
                "size": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
                "local_path": f"r2/{self.priv_bucket}/{key}",
                "http_metadata": {"contentType": mime},
            })
        source_sha = hashlib.sha256(f"source-{tag}".encode()).hexdigest()
        manifest = {
            "databases": [{"name": "workshop", "sha256": source_sha}],
            "buckets": {self.priv_bucket: {"objects": manifest_objs}},
        }
        (backup / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        verification = self.root / f"verification-{tag}.json"
        verification.write_text(
            json.dumps({
                "format": "workshop-taxonomy-verification-v1",
                "ok": True,
                "sourceSha256": source_sha,
                "candidateSha256": taxonomy.file_hash(candidate_path),
            }),
            encoding="utf-8",
        )
        return backup, verification

    def test_prior_plan_reuses_unchanged_keys_and_withdraws_only_revoked_or_replaced_keys(self):
        c1 = self.root / "candidate1.sqlite"
        with closing(create_canonical_db(c1)) as db:
            seed_base_project(db)
            entry_idx = json.dumps({"schemaVersion": 1, "entries": []})
            empty_hash = hashlib.sha256(b"").hexdigest()
            # Project p2 is public in Phase 1, will become private in Phase 2
            db.execute("INSERT INTO projects (id, author_id, visibility) VALUES ('p2', 'u1', 'public')")
            db.execute(
                """INSERT INTO project_versions
                   (id, project_id, version_no, title, description, project_type, included_types, tags, manifest_hash, created_by, entry_index)
                   VALUES ('v20', 'p2', 1, 'BetaCard', 'Desc', '角色', '[]', '["奇幻"]', ?, 'u1', ?)""",
                (empty_hash, entry_idx),
            )
            db.execute("UPDATE projects SET working_version_id='v20', published_version_id='v20' WHERE id='p2'")
            for aid, pid, vid, kind, key, payload in (
                ("c-p1", "p1", "v1", "cover", "covers/src-p1.png", PNG_1),
                ("g-p1", "p1", None, "gallery_1", "projects/p1/g1.png", PNG_2),
                ("c-p2", "p2", "v20", "cover", "covers/src-p2.png", PNG_3),
            ):
                db.execute(
                    "INSERT INTO assets (id, project_id, version_id, kind, r2_key, sha256, bytes, mime) VALUES (?,?,?,?,?,?,?,'image/png')",
                    (aid, pid, vid, kind, key, hashlib.sha256(payload).hexdigest(), len(payload)),
                )
            db.execute(
                "INSERT INTO site_settings (key, value) VALUES ('discover_banner', ?)",
                (json.dumps({"imageUrl": "/api/v1/public-assets/banners/b1.png"}),),
            )
            db.commit()

        objs_1 = {
            "covers/src-p1.png": (PNG_1, "image/png"),
            "projects/p1/g1.png": (PNG_2, "image/png"),
            "covers/src-p2.png": (PNG_3, "image/png"),
            "banners/b1.png": (BANNER_PNG, "image/png"),
        }
        backup1, ver1 = self.write_backup_and_verification(c1, objs_1, "p1")
        plan1_path = self.root / "plan1.json"
        target = public_images.dimensions(self.priv_bucket, self.pub_bucket, self.account, self.origin)
        with taxonomy.snapshot(c1) as (db1, sha1):
            plan1 = public_images.preparation(db1, sha1, ver1, backup1, MIGRATIONS, target)
            taxonomy.json_write(plan1_path, plan1)
            ready1 = self.root / "ready1.sqlite"
            etags1 = {obj["targetKey"]: f"etag-{i}" for i, obj in enumerate(plan1["objects"])}
            public_images.write_ready(db1, ready1, plan1, {"etags": etags1})

        keys1 = {(o["kind"], tuple(o["identity"])): o["targetKey"] for o in plan1["objects"]}
        self.assertEqual(len(keys1), 4)

        # Phase 2: p1 cover & banner stay unchanged; p1 gallery_1 is replaced by PNG_3; p2 becomes private!
        c2 = self.root / "candidate2.sqlite"
        with closing(sqlite3.connect(c1)) as src, closing(sqlite3.connect(c2)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA foreign_keys = ON")
            dst.execute("UPDATE projects SET visibility = 'private' WHERE id = 'p2'")
            dst.execute(
                "UPDATE assets SET r2_key = 'projects/p1/g1-v2.png', sha256 = ?, bytes = ? WHERE id = 'g-p1'",
                (hashlib.sha256(PNG_3).hexdigest(), len(PNG_3)),
            )
            dst.commit()

        objs_2 = {
            **objs_1,
            "projects/p1/g1-v2.png": (PNG_3, "image/png"),
        }
        backup2, ver2 = self.write_backup_and_verification(c2, objs_2, "p2")

        with taxonomy.snapshot(c2) as (db2, sha2):
            plan2_from_json = public_images.preparation(
                db2, sha2, ver2, backup2, MIGRATIONS, target, prior_plan=plan1_path
            )
            plan2_from_sqlite = public_images.preparation(
                db2, sha2, ver2, backup2, MIGRATIONS, target, prior_plan=ready1
            )
            ready2 = self.root / "ready2.sqlite"
            etags2 = {obj["targetKey"]: f"etag2-{i}" for i, obj in enumerate(plan2_from_json["objects"])}
            public_images.write_ready(db2, ready2, plan2_from_json, {"etags": etags2})

        for plan2 in (plan2_from_json, plan2_from_sqlite):
            keys2 = {(o["kind"], tuple(o["identity"])): o["targetKey"] for o in plan2["objects"]}
            self.assertEqual(len(keys2), 3)
            # Unchanged p1 cover and banner MUST reuse exact targetKeys!
            self.assertEqual(keys2[("cover", ("p1",))], keys1[("cover", ("p1",))])
            self.assertEqual(keys2[("banner", (1, "/api/v1/public-assets/banners/b1.png"))],
                             keys1[("banner", (1, "/api/v1/public-assets/banners/b1.png"))])
            # Replaced gallery_1 MUST mint a new targetKey!
            self.assertNotEqual(keys2[("gallery", ("p1", "gallery_1", "g-p1"))],
                                keys1[("gallery", ("p1", "gallery_1", "g-p1"))])

        # Build D1 delta between ready1 and ready2 and verify withdrawn_public_objects!
        delta_dir = self.root / "delta-images"
        delta_manifest = d1_delta.build_delta(ready1, ready2, delta_dir)
        expected_withdrawn = sorted([
            keys1[("cover", ("p2",))],
            keys1[("gallery", ("p1", "gallery_1", "g-p1"))],
        ])
        self.assertEqual(delta_manifest["withdrawn_public_objects"], expected_withdrawn)
        withdrawals_doc = json.loads((delta_dir / "delta-withdrawals.json").read_text(encoding="utf-8"))
        self.assertEqual(withdrawals_doc["objects"], expected_withdrawn)

        # Exercise full-r2.mjs public-withdraw with a fake curl binary that records SigV4 DELETE + GET -> 404
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        curl_log = self.root / "curl-log.jsonl"
        fake_curl = bin_dir / "curl"
        fake_curl.write_text(
            f"""#!/usr/bin/env python3
import json, sys
cfg = sys.stdin.read()
lines = [line.strip() for line in cfg.splitlines() if line.strip()]
method = "DELETE" if any(l.startswith("request =") and "DELETE" in l for l in lines) else "GET"
url = next(l.split("=", 1)[1].strip().strip('"') for l in lines if l.startswith("url ="))
auth = any("Authorization: AWS4-HMAC-SHA256" in l for l in lines)
with open({str(curl_log)!r}, "a", encoding="utf-8") as f:
    f.write(json.dumps({{"method": method, "url": url, "sigv4": auth}}) + "\\n")
status = "204" if method == "DELETE" else "404"
sys.stderr.write(status)
""",
            encoding="utf-8",
        )
        fake_curl.chmod(0o755)

        plan2_file = self.root / "plan2.json"
        taxonomy.json_write(plan2_file, plan2_from_json)
        env = {
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
            "PUBLIC_IMAGE_IMPORT_R2_ACCESS_KEY_ID": "test-access-key",
            "PUBLIC_IMAGE_IMPORT_R2_SECRET_ACCESS_KEY": "test-secret-key",
        }
        proc = subprocess.run(
            [
                sys.executable,
                str(HERE / "offline.py"),
                "public-images",
                "withdraw",
                "--plan",
                str(plan2_file),
                "--withdrawals",
                str(delta_dir / "delta-withdrawals.json"),
                "--confirm-public-target",
            ],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr or proc.stdout)
        out = json.loads(proc.stdout)
        self.assertEqual(out, {"ok": True, "mode": "withdraw", "targetPublicBucket": self.pub_bucket, "objects": 2, "deleted": 2})
        logged = [json.loads(line) for line in curl_log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual([entry["method"] for entry in logged], ["DELETE", "GET", "DELETE", "GET"])
        self.assertTrue(all(entry["sigv4"] for entry in logged))

        # Reject any non-PUBLIC_KEY key in full-r2.mjs public-withdraw!
        bad_withdraw = self.root / "bad-withdraw.json"
        bad_withdraw.write_text(
            json.dumps({
                "account": self.account,
                "publicBucket": self.pub_bucket,
                "objects": ["projects/p1/worldbook.json"],
            }),
            encoding="utf-8",
        )
        bad_proc = subprocess.run(
            ["node", str(HERE / "full-r2.mjs"), "public-withdraw", str(bad_withdraw)],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(bad_proc.returncode, 0)
        self.assertIn("invalid public withdrawal key", bad_proc.stderr)


class BoundPreloadRecoveryTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.account = "a" * 32
        self.token = "test-import-token"
        self.db_id = "20000000-0000-4000-8000-000000000002"
        self.db_name = "workshop-prod"

    def make_fake_plan(self):
        plan_dir = self.root / "plan"
        (plan_dir / "batches").mkdir(parents=True, mode=0o700)
        b0 = plan_dir / "batches" / "000001.sql"
        b0.write_text("PRAGMA foreign_keys = ON;\nSELECT 1;\n", encoding="utf-8")
        b0.chmod(0o600)
        (plan_dir / "inventory.json").write_text(json.dumps({"tables": {}}), encoding="utf-8")
        plan = {
            "plan_id": "f" * 64,
            "candidate_name": "workshop-staging-migrate-ffffffffffff",
            "schema": [],
            "batches": [{"id": "000001", "phase": "initialize:0001_initial.sql", "file": "batches/000001.sql",
                         "sha256": staging.digest(b0), "data_rows": 0, "estimated_rows_written": 1}],
        }
        plan_path = plan_dir / "plan.json"
        plan_path.write_text(json.dumps(plan), encoding="utf-8")
        plan_path.chmod(0o600)
        return plan_path, plan

    def test_capture_bookmark_fails_closed_without_wrangler_cli_fallback(self):
        class BrokenCloud:
            def request(self, _suffix):
                return {}

        bookmark_file = self.root / "recovery-bookmark.json"
        with patch("subprocess.check_output", side_effect=AssertionError("must not shell out to wrangler")):
            with self.assertRaisesRegex(ValueError, "Time Travel recovery bookmark"):
                bound_preload.capture_bookmark(BrokenCloud(), self.db_id, bookmark_file)
        self.assertFalse(bookmark_file.exists())

    def test_replicas_unknown_resumes_completed_and_unstarted_and_failed_cleanly(self):
        plan_path, base_plan = self.make_fake_plan()
        replicas_sql = self.root / "replicas.sql"
        replicas_sql.write_text(
            "PRAGMA foreign_keys = ON;\nDELETE FROM public_cover_replicas;\n"
            "INSERT INTO public_cover_replicas (project_id,object_key,phase,reservation_etag) "
            "VALUES ('p1','covers/00000000-0000-4000-8000-000000000001','ready','etag1');\n",
            encoding="utf-8",
        )
        replicas_sql.chmod(0o600)
        sql_sha = staging.digest(replicas_sql)

        def init_state(name: str):
            state_dir = self.root / name
            bound_plan = dict(base_plan, candidate_name=self.db_name)
            j = staging.open_journal(state_dir, plan_path, bound_plan, self.account, self.token)
            day = staging.budget.day_key()
            ledger = {day: {"charged": 128}}
            receipts_dir = state_dir / "replicas-import"
            pending = {"id": "replicas", "sha256": sql_sha, "day": day, "reserved": 128, "receipts": str(receipts_dir)}
            j.record(
                "replicas-requested",
                candidate_database_id=self.db_id,
                candidate_name=self.db_name,
                next_batch=1,
                phase="replicas_unknown",
                ledger=ledger,
                pending_replicas=pending,
            )
            j.close()
            return state_dir, receipts_dir, day

        # Case 1: Completed receipt in replicas-import settles ledger via saved_status(resume=True) without re-executing!
        state_ok, receipts_ok, day = init_state("state-complete")
        child = staging.imp.Journal(receipts_ok, self.token, create=True)
        child.record(
            "prepared",
            version=1,
            account_id=self.account,
            database_id=self.db_id,
            candidate_name=self.db_name,
            file={"sha256": sql_sha},
            at_bookmark="bm-123",
            phase="poll_received",
        )
        child.close()

        env = {"CLOUDFLARE_ACCOUNT_ID": self.account, "PRODUCTION_IMPORT_TOKEN": self.token}
        with patch.dict(os.environ, env, clear=False), patch.object(bound_preload, "load_module", return_value=staging), patch.object(
            staging, "checked_plan", return_value=base_plan
        ), patch.object(
            staging.imp,
            "saved_status",
            return_value={"ok": True, "outcome": "complete", "statistics": {"rows_written": 5}},
        ) as saved_mock, patch.object(staging.imp, "execute", side_effect=AssertionError("must not re-execute")):
            stdout, stderr = io.StringIO(), io.StringIO()
            argv = [
                "offline.py",
                "preload",
                "replicas",
                "--plan",
                str(plan_path),
                "--state-dir",
                str(state_ok),
                "--database-id",
                self.db_id,
                "--database-name",
                self.db_name,
                "--replicas-sql",
                str(replicas_sql),
                "--confirm-target",
            ]
            with patch.object(sys, "argv", argv), redirect_stdout(stdout), redirect_stderr(stderr):
                code = offline.main()
            self.assertEqual(code, 0, stderr.getvalue())
            saved_mock.assert_called_once_with(receipts_ok, resume=True)
            status = json.loads(stdout.getvalue())
            self.assertEqual(status["phase"], "replicas_loaded")
            self.assertIsNone(status["pending_replicas"])
            self.assertEqual(status["replicas_sha256"], sql_sha)
            reopened = staging.imp.Journal(state_ok, self.token)
            try:
                self.assertEqual(reopened.state["ledger"][day]["charged"], 5)
            finally:
                reopened.close()

        # Case 2: Unstarted target_unknown refunds reservation and retries cleanly on a fresh attempt directory!
        state_unstarted, receipts_unstarted, _ = init_state("state-unstarted")
        child2 = staging.imp.Journal(receipts_unstarted, self.token, create=True)
        child2.record(
            "prepared",
            version=1,
            account_id=self.account,
            database_id=self.db_id,
            candidate_name=self.db_name,
            file={"sha256": sql_sha},
            phase="target_unknown",
        )
        child2.close()
        with patch.dict(os.environ, env, clear=False), patch.object(bound_preload, "load_module", return_value=staging), patch.object(
            staging, "checked_plan", return_value=base_plan
        ), patch.object(
            staging.budget, "analytics", return_value={"day": day, "rows_written": 0, "rows_read": 0}
        ), patch.object(
            staging.imp,
            "execute",
            return_value={"ok": True, "outcome": "complete", "statistics": {"rows_written": 4}},
        ) as exec_mock:
            stdout, stderr = io.StringIO(), io.StringIO()
            argv = [
                "offline.py",
                "preload",
                "replicas",
                "--plan",
                str(plan_path),
                "--state-dir",
                str(state_unstarted),
                "--database-id",
                self.db_id,
                "--database-name",
                self.db_name,
                "--replicas-sql",
                str(replicas_sql),
                "--confirm-target",
            ]
            with patch.object(sys, "argv", argv), redirect_stdout(stdout), redirect_stderr(stderr):
                code = offline.main()
            self.assertEqual(code, 0, stderr.getvalue())
            self.assertTrue(str(exec_mock.call_args.args[2]).endswith("replicas-import-attempt-001"))
            status = json.loads(stdout.getvalue())
            self.assertEqual(status["phase"], "replicas_loaded")
            self.assertEqual(status["replicas_sha256"], sql_sha)

        # Case 3: Failed saved_status transitions journal cleanly to failed (pending_replicas=None) instead of stranding!
        state_err, receipts_err, _ = init_state("state-error")
        child3 = staging.imp.Journal(receipts_err, self.token, create=True)
        child3.record(
            "prepared",
            version=1,
            account_id=self.account,
            database_id=self.db_id,
            candidate_name=self.db_name,
            file={"sha256": sql_sha},
            at_bookmark="bm-err",
            outcome="error",
            phase="error",
        )
        child3.close()
        with patch.dict(os.environ, env, clear=False), patch.object(bound_preload, "load_module", return_value=staging), patch.object(
            staging, "checked_plan", return_value=base_plan
        ), patch.object(
            staging.imp, "saved_status", return_value={"ok": False, "outcome": "error", "statistics": {}}
        ):
            stdout, stderr = io.StringIO(), io.StringIO()
            argv = [
                "offline.py",
                "preload",
                "replicas",
                "--plan",
                str(plan_path),
                "--state-dir",
                str(state_err),
                "--database-id",
                self.db_id,
                "--database-name",
                self.db_name,
                "--replicas-sql",
                str(replicas_sql),
                "--confirm-target",
            ]
            with patch.object(sys, "argv", argv), redirect_stdout(stdout), redirect_stderr(stderr):
                code = offline.main()
            self.assertEqual(code, 1)
            reopened = staging.imp.Journal(state_err, self.token)
            try:
                self.assertEqual(reopened.state["phase"], "failed")
                self.assertIsNone(reopened.state["pending_replicas"])
                self.assertEqual(reopened.state["failure"], "replicas_import_failed")
            finally:
                reopened.close()


if __name__ == "__main__":
    unittest.main()

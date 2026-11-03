#!/usr/bin/env python3
"""Offline candidate-plan provenance, pause-boundary, FTS and long-row regressions."""
import copy
from contextlib import closing
from datetime import date, timedelta
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


planner = module("multiday_plan_regression", "multiday-plan.py")
MIGRATIONS = Path(__file__).resolve().parents[2] / "apps/worker/migrations"


class AtomicPlanBatchTest(unittest.TestCase):
    def test_failed_batch_rolls_back_without_changing_previous_committed_batches(self):
        with tempfile.TemporaryDirectory() as temporary, closing(sqlite3.connect(":memory:")) as db:
            root = Path(temporary)
            (root / "batches").mkdir()
            emitter = planner.Emitter(root, db)
            emitter.emit("initial", [
                "CREATE TABLE retained(id INTEGER PRIMARY KEY, value TEXT)",
                "INSERT INTO retained VALUES(1, 'previous batch')",
            ], 1, 128)
            with self.assertRaises(sqlite3.IntegrityError):
                emitter.emit("conflict", [
                    "INSERT INTO retained VALUES(2, 'must roll back')",
                    "INSERT INTO retained VALUES(1, 'conflicting key')",
                ], 2, 128)
            self.assertEqual(db.execute("SELECT * FROM retained ORDER BY id").fetchall(),
                             [(1, "previous batch")])
            self.assertFalse(db.in_transaction)


class MultidayPlanTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.migrations = self.root / "migrations"
        shutil.copytree(MIGRATIONS, self.migrations)
        self.preparation = self.root / "preparation.json"
        self.source = self.root / "source.sql"
        self.manifest = self.root / "manifest.json"
        self.description = "long quoted ' description\n" * 2400
        db = sqlite3.connect(":memory:")
        db.executescript("""
            CREATE TABLE users (id TEXT,username TEXT,global_name TEXT,avatar TEXT,
                is_admin INTEGER,created_at TEXT,updated_at TEXT);
            INSERT INTO users VALUES ('u1','WriterNeedle','AuthorNeedle',NULL,0,
                '2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
            CREATE TABLE projects (id TEXT,author_id TEXT,name TEXT,description TEXT,status TEXT,
                is_published INTEGER,visibility INTEGER,created_at TEXT,updated_at TEXT,
                tags TEXT,extension_type TEXT,downloads_count INTEGER,likes_count INTEGER,
                cover_position_x REAL,cover_position_y REAL,cover_zoom REAL);
            CREATE TABLE project_likes (project_id TEXT,user_id TEXT,created_at TEXT);
            INSERT INTO project_likes VALUES ('p-first','u1','2026-01-01T00:00:00.000Z');
            CREATE TABLE project_subscribes (project_id TEXT,user_id TEXT,created_at TEXT);
            CREATE TABLE project_ratings (project_id TEXT,user_id TEXT,rating INTEGER,
                comment_text TEXT,created_at TEXT,updated_at TEXT);
            CREATE TABLE project_metric_daily (project_id TEXT,day_key TEXT,downloads INTEGER,likes_delta INTEGER);
            CREATE TABLE daily_random_draw_state (id TEXT);
            CREATE TABLE devteam_recommendations (project_id TEXT);
            CREATE TABLE admins (user_id TEXT);
            CREATE TABLE super_admins (user_id TEXT);
            CREATE TABLE character_references (id TEXT);
            CREATE TABLE character_reference_versions (id TEXT);
            CREATE TABLE character_reference_items (id TEXT);
            CREATE TABLE site_settings (key TEXT,value TEXT,updated_at TEXT,updated_by TEXT);
            INSERT INTO site_settings VALUES ('environment-secret','legacy-value','2026-01-01',NULL);
            CREATE TABLE admin_action_logs (id TEXT);
            CREATE TABLE project_metadata_audit_logs (id TEXT);
            CREATE TABLE discovery_feature_history (id TEXT);
        """)
        for identity, title, tags, count, likes in (
                ("p-first", "AlpineNeedle", '["TagNeedle","shared"]', 9, 1),
                ("p-second", "BirchNeedle", '["OtherTag"]', 0, 0)):
            db.execute("INSERT INTO projects VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                identity, "u1", title, self.description if identity == "p-first" else "short", "draft", 0, 0,
                "2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", tags, "ExtensionNeedle", count, likes, 50, 50, 1))
        # More than one ordinary batch, with the count and exact-day history
        # distinguishable from the one active like and current aggregate counter.
        for offset in range(252):
            db.execute("INSERT INTO project_metric_daily VALUES (?,?,?,?)", (
                "p-first", (date(2025, 1, 1) + timedelta(days=offset)).isoformat(),
                7 if offset == 0 else 2 if offset == 1 else 0,
                3 if offset == 0 else -1 if offset == 1 else 0))
        self.source.write_text("\n".join(db.iterdump()) + "\n", encoding="utf-8")
        db.close()
        self.manifest.write_text(json.dumps({"databases": [{"name": "creative_workshop",
            "sha256": hashlib.sha256(self.source.read_bytes()).hexdigest(), "table_counts": {}}],
            "buckets": {}}), encoding="utf-8")
        transformed = subprocess.run([sys.executable, str(Path(__file__).with_name("full-transform.py")),
            str(self.source), str(self.manifest), str(self.preparation)], capture_output=True, text=True, check=False)
        self.assertEqual(transformed.returncode, 0, "synthetic source preparation failed")
        self.assertEqual(json.loads(self.preparation.read_text(encoding="utf-8"))["diagnostics"], [])

    def build(self, name="plan"):
        root = self.root / name
        plan = planner.build(self.preparation, self.source, self.manifest, self.migrations, root)
        return root, plan

    def test_pauses_resume_without_counter_or_history_duplication_and_search_maps_ids(self):
        root, plan = self.build()
        self.assertEqual(planner.validate_plan(root / "plan.json"), plan)
        self.assertEqual((root / "preparation.json").read_bytes(), self.preparation.read_bytes())
        self.assertEqual(os.stat(root).st_mode & 0o777, 0o700)
        self.assertEqual(os.stat(root / "plan.json").st_mode & 0o777, 0o600)
        path = self.root / "resumed.sqlite"
        completed = []
        split = next(index for index, batch in enumerate(plan["batches"])
                     if batch["phase"] == "data:project_metrics_daily") + 1
        db = sqlite3.connect(path)
        for index, batch in enumerate(plan["batches"]):
            if index == split:
                # A durable executor skips acknowledged batches after reopening.
                (self.root / "completed.json").write_text(json.dumps(completed), encoding="utf-8")
                db.close()
                db = sqlite3.connect(path)
                completed = json.loads((self.root / "completed.json").read_text(encoding="utf-8"))
            if batch["id"] in completed:
                continue
            sql = (root / batch["file"]).read_text(encoding="utf-8")
            self.assertTrue(all(len(statement.encode("utf-8")) <= 64_000 for statement in planner.statements(sql)))
            self.assertLessEqual(batch["data_rows"], 250)
            self.assertGreater(batch["estimated_rows_written"], 0)
            db.executescript(sql)
            self.assertEqual(db.execute("PRAGMA foreign_keys").fetchone()[0], 1)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [], batch["id"])
            self.assertEqual(db.execute("SELECT name FROM sqlite_schema WHERE name LIKE '_workshop_multiday%'").fetchall(), [])
            completed.append(batch["id"])
            ledger = db.execute("SELECT id,name FROM d1_migrations ORDER BY id").fetchall()
            migration_names = sorted(path.name for path in self.migrations.glob("*.sql"))
            self.assertEqual(ledger, list(enumerate(migration_names[:len(ledger)], 1)))
        self.addCleanup(db.close)
        self.assertEqual(db.execute("SELECT likes_count,downloads_count,subscriptions_count FROM projects WHERE id='p-first'").fetchone(), (1, 9, 0))
        self.assertEqual(db.execute("SELECT count(*) FROM project_metrics_daily").fetchone()[0], 252)
        self.assertEqual(db.execute("SELECT project_id,day_key,downloads,likes_delta FROM project_metrics_daily WHERE project_id='p-first' ORDER BY day_key").fetchall()[:2],
                         [("p-first", "2025-01-01", 7, 3), ("p-first", "2025-01-02", 2, -1)])
        self.assertEqual(db.execute("SELECT count(*) FROM download_daily_stats").fetchone()[0], 0)
        self.assertEqual(db.execute("SELECT description FROM project_versions WHERE project_id='p-first'").fetchone()[0], self.description)
        self.assertIsNone(db.execute("SELECT value FROM site_settings WHERE key='environment-secret'").fetchone())
        self.assertEqual(db.execute("SELECT value FROM site_settings WHERE key='cache_epoch'").fetchone(), ("1",))
        ledger = db.execute("SELECT id,name,applied_at FROM d1_migrations ORDER BY id").fetchall()
        self.assertEqual([(row[0], row[1]) for row in ledger],
                         list(enumerate(sorted(path.name for path in self.migrations.glob("*.sql")), 1)))
        self.assertTrue(all(row[2] == db.execute("SELECT datetime(?)", (row[2],)).fetchone()[0] for row in ledger))
        self.assertEqual(db.execute("SELECT seq FROM sqlite_sequence WHERE name='d1_migrations'").fetchone(), (len(plan["inputs"]["migrations"]),))
        self.assertEqual(planner.validate_ledger(db, plan["inputs"]["migrations"]), plan["migration_ledger"])
        db.execute("UPDATE d1_migrations SET name='unexpected.sql' WHERE id=1")
        with self.assertRaisesRegex(ValueError, "ledger ordered names"):
            planner.validate_ledger(db, plan["inputs"]["migrations"])
        db.rollback()
        for needle, expected in (("AlpineNeedle", []), ("BirchNeedle", []),
                                 ("TagNeedle", []), ("AuthorNeedle", [])):
            actual = db.execute("SELECT p.id FROM project_search JOIN projects p ON p.rowid=project_search.rowid "
                                "WHERE project_search MATCH ? ORDER BY p.id", (needle,)).fetchall()
            self.assertEqual([row[0] for row in actual], expected)
        short = db.execute("SELECT p.id FROM project_search_short JOIN projects p ON p.rowid=project_search_short.rowid "
                           "WHERE project_search_short MATCH '\"A l\"' ORDER BY p.id").fetchall()
        self.assertEqual(short, [])
        canonical = sqlite3.connect(":memory:")
        self.addCleanup(canonical.close)
        for migration in sorted(self.migrations.glob("*.sql")):
            canonical.executescript(migration.read_text(encoding="utf-8"))
        self.assertEqual(planner.schema(db), planner.schema(canonical))
        expected = sqlite3.connect(root / "expected.sqlite")
        self.addCleanup(expected.close)
        self.assertEqual(planner.rows_digest(db), planner.rows_digest(expected))
        # Restored canonical triggers must resume normal incremental behavior.
        db.execute("UPDATE projects SET published_version_id=working_version_id, published_at='2026-01-02T00:00:00.000Z'")
        self.assertEqual(db.execute("SELECT count(*) FROM project_search WHERE project_search MATCH 'AlpineNeedle'").fetchone()[0], 1)
        db.execute("UPDATE users SET global_name='ChangedAuthor' WHERE id='u1'")
        self.assertEqual(db.execute("SELECT count(*) FROM project_search WHERE project_search MATCH 'ChangedAuthor'").fetchone()[0], 2)
        db.execute("UPDATE project_versions SET title='ChangedTitle' WHERE project_id='p-second'")
        db.execute("UPDATE projects SET published_version_id=published_version_id WHERE id='p-second'")
        self.assertEqual(db.execute("SELECT p.id FROM project_search JOIN projects p ON p.rowid=project_search.rowid "
                                   "WHERE project_search MATCH 'ChangedTitle'").fetchall(), [("p-second",)])

    def test_reproducible_plan_identity_and_changed_inputs_or_schema_fail_closed(self):
        root, plan = self.build()
        _, repeated = self.build("repeat")
        self.assertEqual(repeated, plan)
        original = self.source.read_bytes()
        self.source.write_bytes(original + b"\n-- source changed\n")
        with self.assertRaisesRegex(ValueError, "immutable"):
            planner.validate_plan(root / "plan.json")
        self.source.write_bytes(original)
        migration = sorted(self.migrations.glob("*.sql"))[-1]
        original_migration = migration.read_bytes()
        migration.write_bytes(original_migration + b"\n-- migration changed\n")
        with self.assertRaisesRegex(ValueError, "immutable"):
            planner.validate_plan(root / "plan.json")
        migration.write_bytes(original_migration)
        changed = copy.deepcopy(plan)
        changed["schema_sha256"] = "0" * 64
        changed["plan_id"] = planner.plan_digest(changed)
        changed["candidate_name"] = "workshop-staging-migrate-" + changed["plan_id"][:12]
        (root / "plan.json").write_text(planner.stable(changed), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "schema hash"):
            planner.validate_plan(root / "plan.json")

    def test_source_reconciliation_precedes_derivation_and_schema_loading(self):
        data = json.loads(self.preparation.read_text(encoding="utf-8"))
        data["tables"]["projects"][0]["downloads_count"] += 1
        self.preparation.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "approved source"):
            self.build()
        self.assertFalse((self.root / "plan").exists())

    def test_long_keys_are_rejected_instead_of_publishing_an_unimportable_plan(self):
        # The source accepts a long username; the indexed search document can
        # still be bounded, but a huge primary key cannot be text-chunked safely.
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("CREATE TABLE keyed(id TEXT PRIMARY KEY, value TEXT);")
        lines = ["PRAGMA foreign_keys=ON;"]
        with self.assertRaisesRegex(ValueError, "unsupported large keys"):
            planner.stage.insert_row(db, "keyed", {"id": "k" * 40_000, "value": "text"}, {"keyed"}, lines, False, "chunks")
        self.assertEqual(db.execute("SELECT count(*) FROM keyed").fetchone()[0], 0)

    def test_corrupted_batch_and_expected_snapshot_are_detected(self):
        root, plan = self.build()
        batch = root / plan["batches"][-1]["file"]
        original = batch.read_bytes()
        batch.write_bytes(original + b"SELECT 1;\n")
        with self.assertRaisesRegex(ValueError, "batch SQL"):
            planner.validate_plan(root / "plan.json")
        batch.write_bytes(original)
        with closing(sqlite3.connect(root / "expected.sqlite")) as db:
            db.execute("UPDATE project_versions SET description='corrupted' WHERE project_id='p-first'")
            db.commit()
        with self.assertRaisesRegex(ValueError, "snapshot changed"):
            planner.validate_plan(root / "plan.json")


if __name__ == "__main__":
    unittest.main()

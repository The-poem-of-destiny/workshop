#!/usr/bin/env python3
"""Synthetic source reconciliation regression tests; no credentials or network access."""
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

LOADER = Path(__file__).with_name("full-load.py")
TRANSFORMER = Path(__file__).with_name("full-transform.py")
REVISION = "legacy-revision-a49ba8bb2e513b949be40d114a144ced7ad3852164005c4ad1878e10049b787a"
AUDIT_ID = "legacy-audit-7b691fac9d9d88c43eea5d75a67a9ee2ecf6b3e4c914d66ded92bbc40d681b5e"
RECOMMENDATION_ID = "legacy-recommendation-0aa5526348f04baa5d1204a6e808883018bb26a4963653984f90103cd14e6e1e"


class SourceReconciliationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE users (id TEXT, username TEXT, global_name TEXT, avatar TEXT, is_admin INTEGER, created_at TEXT, updated_at TEXT);
            INSERT INTO users VALUES ('u1', 'synthetic', NULL, NULL, 1, 't1', 't2');
            CREATE TABLE projects (id TEXT, author_id TEXT, name TEXT, description TEXT, status TEXT, is_published INTEGER, visibility INTEGER, created_at TEXT, updated_at TEXT, reviewed_at TEXT);
            INSERT INTO projects VALUES ('p1', 'u1', 'Example', 'Description', 'approved', 1, 1, 't1', 't2', 't1');
            CREATE TABLE project_likes (project_id TEXT);
            CREATE TABLE project_subscribes (project_id TEXT);
            CREATE TABLE project_ratings (project_id TEXT);
            CREATE TABLE project_metric_daily (project_id TEXT);
            CREATE TABLE daily_random_draw_state (id TEXT);
            CREATE TABLE devteam_recommendations (project_id TEXT, curator_id TEXT, comment_text TEXT, reaction_label TEXT, created_at TEXT, updated_at TEXT);
            INSERT INTO devteam_recommendations VALUES ('p1', 'u1', 'recommended', 'good', 't1', 't2');
            CREATE TABLE devteam_curators (user_id TEXT, enabled INTEGER);
            INSERT INTO devteam_curators VALUES ('u1', 1);
            CREATE TABLE admins (user_id TEXT);
            CREATE TABLE super_admins (user_id TEXT);
            CREATE TABLE character_references (id TEXT, name TEXT);
            INSERT INTO character_references VALUES ('r1', 'Reference');
            CREATE TABLE character_reference_versions (id TEXT, character_reference_id TEXT);
            INSERT INTO character_reference_versions VALUES ('v1', 'r1');
            CREATE TABLE character_reference_items (id TEXT, name TEXT);
            INSERT INTO character_reference_items VALUES ('i1', 'Item');
            CREATE TABLE site_settings (id TEXT);
            CREATE TABLE admin_action_logs (id TEXT, action TEXT, actor_id TEXT, actor_name TEXT, target_type TEXT, target_id TEXT, detail TEXT, created_at TEXT);
            INSERT INTO admin_action_logs VALUES ('a1', 'admin_added', 'u1', 'synthetic', 'project', 'p1', 'details', 't1');
            CREATE TABLE project_metadata_audit_logs (id TEXT);
            CREATE TABLE discovery_feature_history (id TEXT);
        """)
        self.dump = "\n".join(db.iterdump()) + "\n"
        self.tables = {name: [] for name in (
            "users", "projects", "project_versions", "project_likes", "project_subscriptions",
            "project_ratings", "project_metrics_daily", "site_settings", "audit_events", "recommendations", "assets")}
        self.tables["users"] = [{"id": "u1", "username": "synthetic", "global_name": None, "avatar": None, "role": "member", "created_at": "t1", "updated_at": "t2"}]
        self.tables["projects"] = [{"id": "p1", "author_id": "u1", "working_version_id": REVISION, "published_version_id": REVISION, "visibility": "public", "published_at": "t1", "published_updated_at": "t1", "downloads_count": 0, "likes_count": 0, "subscriptions_count": 0, "created_at": "t1", "updated_at": "t2"}]
        self.tables["project_versions"] = [{"id": REVISION, "project_id": "p1", "created_by": "u1", "title": "Example", "description": "Description", "tags": "[]", "entry_index": '{"schemaVersion":1,"entries":[]}', "worldbook_count": 0, "regex_count": 0, "manifest_hash": hashlib.sha256(b"").hexdigest()}]
        self.tables["audit_events"] = [{"id": AUDIT_ID, "action": "legacy.admin_added", "target_type": "project", "target_id": "p1", "actor_id": "u1", "detail": '{"legacyActorId":"u1","legacyActorName":"synthetic","legacyDetail":"details","legacyTargetId":"p1","sourceTable":"admin_action_logs"}', "created_at": "t1"}]
        self.tables["recommendations"] = [{"id": RECOMMENDATION_ID, "curator_id": "u1", "project_id": "p1", "project_version_id": REVISION, "comment": "recommended", "created_at": "t1", "updated_at": "t2"}]
        self.data = {"format": "workshop-full-migration-preparation-v1", "tables": self.tables,
                     "diagnostics": [], "omissions": [{"table": "projects", "source": {"id": "p1"},
                     "reason": "source revision has no content asset"}], "objects": []}
        self.data["omissions"].extend({"table": table, "source": row,
            "reason": "reference baseline feature removed (R-18); source backup retained"}
            for table, row in (
                ("character_references", {"id": "r1", "name": "Reference"}),
                ("character_reference_versions", {"id": "v1", "character_reference_id": "r1"}),
                ("character_reference_items", {"id": "i1", "name": "Item"})))

    def run_source(self, data=None, dump=None):
        dump = self.dump if dump is None else dump
        source = self.directory / "source.sql"
        source.write_text(dump, encoding="utf-8")
        manifest = self.directory / "manifest.json"
        manifest.write_text(json.dumps({"databases": [{"name": "creative_workshop", "sha256": hashlib.sha256(dump.encode()).hexdigest(), "table_counts": {}}], "buckets": {}}), encoding="utf-8")
        preparation = self.directory / "preparation.json"
        preparation.write_text(json.dumps(data if data is not None else self.data), encoding="utf-8")
        result = subprocess.run([sys.executable, str(LOADER), "source", str(preparation), str(source), str(manifest)], capture_output=True, text=True, check=False)
        return result, json.loads(result.stdout)

    def test_source_unbacked_target_table_is_rejected(self):
        data = copy.deepcopy(self.data)
        data["tables"]["sessions"] = [{"user_id": "u1", "token_hash": "unbacked"}]
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 1, (result.stderr, report))
        self.assertIn({"kind": "unexpected_target_table", "table": "sessions"}, report["failures"])

    def test_deleted_candidate_cannot_hide_retained_project(self):
        data = copy.deepcopy(self.data)
        data["tables"]["projects"][0]["deleted_at"] = "t3"
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 1, (result.stderr, report))
        self.assertIn({"kind": "source_difference", "check": "projects"}, report["failures"])

    def snapshot_dump(self, published=True, visible=True):
        with sqlite3.connect(":memory:") as db:
            db.executescript(self.dump)
            db.executescript("""
                ALTER TABLE projects ADD COLUMN root_project_id TEXT;
                ALTER TABLE projects ADD COLUMN published_project_id TEXT;
                ALTER TABLE projects ADD COLUMN draft_project_id TEXT;
                ALTER TABLE projects ADD COLUMN project_type TEXT;
                ALTER TABLE projects ADD COLUMN extension_type TEXT;
                ALTER TABLE projects ADD COLUMN version_label TEXT;
                ALTER TABLE projects ADD COLUMN version TEXT;
                ALTER TABLE projects ADD COLUMN precautions TEXT;
                ALTER TABLE projects ADD COLUMN cover_position_x REAL;
                ALTER TABLE projects ADD COLUMN cover_position_y REAL;
                ALTER TABLE projects ADD COLUMN cover_zoom REAL;
                ALTER TABLE projects ADD COLUMN tags TEXT;
                ALTER TABLE projects ADD COLUMN custom_tags TEXT;
                ALTER TABLE projects ADD COLUMN facets TEXT;
                ALTER TABLE projects ADD COLUMN discord_thread_url TEXT;
                UPDATE projects SET name='Released title', description='Released description',
                    published_project_id='p1', draft_project_id='draft', reviewed_at='t2',
                    project_type='worldbook', extension_type='released-extension',
                    version_label='release-1', version='old-release', precautions='Released precautions',
                    cover_position_x=0.2, cover_position_y=0.3, cover_zoom=1.2,
                    tags='["released","shared"]', custom_tags='["released-custom","shared"]',
                    facets='{"theme":["released-facet"]}',
                    discord_thread_url='https://discord.com/channels/100/200';
                INSERT INTO projects (id, root_project_id, author_id, name, description, status,
                    is_published, visibility, created_at, updated_at, project_type, extension_type,
                    version, precautions, cover_position_x, cover_position_y, cover_zoom,
                    tags, custom_tags, facets, discord_thread_url)
                VALUES ('draft', 'p1', 'u1', 'Working title', 'Working description', 'draft',
                    0, 0, 't3', 't4', 'extension', 'working-extension', 'working-2',
                    'Working precautions', 0.7, 0.8, 2.1,
                    '["working","shared"]', '["working-custom","shared"]',
                    '{"theme":["working-facet"]}', 'https://discord.com/channels/100/300');
            """)
            if not published:
                db.execute("UPDATE projects SET published_project_id=NULL, is_published=0 WHERE id='p1'")
            if not visible:
                db.execute("UPDATE projects SET visibility=0 WHERE id='p1'")
            if not published or not visible:
                db.execute("DELETE FROM devteam_recommendations")
            return "\n".join(db.iterdump()) + "\n"

    def run_transform(self, dump):
        source = self.directory / "source.sql"
        source.write_text(dump, encoding="utf-8")
        manifest = self.directory / "manifest.json"
        manifest.write_text(json.dumps({"databases": [{"name": "creative_workshop",
            "sha256": hashlib.sha256(dump.encode()).hexdigest(), "table_counts": {}}],
            "buckets": {}}), encoding="utf-8")
        output = self.directory / f"transformed-{hashlib.sha256(dump.encode()).hexdigest()}.json"
        result = subprocess.run([sys.executable, str(TRANSFORMER), str(source), str(manifest), str(output)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(data["diagnostics"], [])
        return data

    def assert_working_revision(self, data, project):
        working = next(row for row in data["tables"]["project_versions"]
                       if row["id"] == project["working_version_id"])
        expected = {
            "title": "Working title", "description": "Working description",
            "project_type": "extension", "extension_type": "working-extension",
            "version_label": "working-2", "requirements": json.dumps({"schemaVersion":1,"dependencies":[],"conflicts":[],"notes":"Working precautions"},sort_keys=True,separators=(",",":")),
            "cover_position_x": 0.7, "cover_position_y": 0.8, "cover_zoom": 2.1,
            "tags": '["working","shared","working-custom","working-facet"]',
            "discord_thread_url": "https://discord.com/channels/100/300",
        }
        self.assertEqual({field: working[field] for field in expected}, expected)
        return working

    def test_published_projection_never_uses_working_metadata(self):
        for visible in (True, False):
            with self.subTest(visible=visible):
                dump = self.snapshot_dump(visible=visible)
                data = self.run_transform(dump)
                project, = data["tables"]["projects"]
                self.assertEqual(project["visibility"], "public" if visible else "private")
                self.assertNotEqual(project["working_version_id"], project["published_version_id"])
                working = self.assert_working_revision(data, project)
                published = next(row for row in data["tables"]["project_versions"]
                                 if row["id"] == project["published_version_id"])
                self.assertEqual(published["title"], "Released title")
                self.assertEqual(published["tags"], '["released","shared","released-custom","released-facet"]')
                self.assertEqual(published["discord_thread_url"], "https://discord.com/channels/100/200")
                self.assertEqual(json.loads(published["requirements"])["notes"], "Released precautions")
                self.assertEqual(len(data["tables"]["project_versions"]), 2)
                self.assertNotEqual(working["id"], published["id"])
                result, report = self.run_source(data, dump)
                self.assertEqual(result.returncode, 0, (result.stderr, report))

    def test_unpublished_projection_uses_working_snapshot_without_published_url(self):
        dump = self.snapshot_dump(published=False)
        data = self.run_transform(dump)
        project, = data["tables"]["projects"]
        working = self.assert_working_revision(data, project)
        self.assertEqual(project["visibility"], "private")
        self.assertIsNone(project["published_version_id"])
        self.assertEqual(len(data["tables"]["project_versions"]), 1)
        result, report = self.run_source(data, dump)
        self.assertEqual(result.returncode, 0, (result.stderr, report))

    def test_baseline_and_missing_or_altered_rows(self):
        result, report = self.run_source()
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        self.assertTrue(report["ok"])
        for table, field in (("audit_events", "action"), ("recommendations", "comment")):
            for mutation in ("missing", "altered"):
                with self.subTest(table=table, mutation=mutation):
                    data = copy.deepcopy(self.data)
                    if mutation == "missing":
                        data["tables"][table].clear()
                    else:
                        data["tables"][table][0][field] = "tampered"
                    result, report = self.run_source(data)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertFalse(report["ok"])
                    self.assertIn({"kind": "source_difference", "check": table}, report["failures"])
                    self.assertEqual(report["checks"][table]["missing"], 1)
                    self.assertEqual(report["checks"][table]["extra"], int(mutation == "altered"))

    def test_missing_required_target_table_even_when_empty(self):
        data = copy.deepcopy(self.data)
        del data["tables"]["assets"]
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(report["ok"])
        self.assertIn({"kind": "missing_or_invalid_target_table", "table": "assets"}, report["failures"])

    def test_missing_required_source_table(self):
        dump = self.dump.replace('CREATE TABLE discovery_feature_history (id TEXT);\n', '')
        self.assertNotEqual(dump, self.dump)
        result, report = self.run_source(dump=dump)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report, {"ok": False, "error": "input_or_schema_error"})


if __name__ == "__main__":
    unittest.main()

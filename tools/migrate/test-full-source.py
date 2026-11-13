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

import taxonomy

LOADER = Path(__file__).with_name("full-load.py")
TRANSFORMER = Path(__file__).with_name("full-transform.py")
REVISION = "legacy-revision-a49ba8bb2e513b949be40d114a144ced7ad3852164005c4ad1878e10049b787a"
AUDIT_ID = "legacy-audit-7b691fac9d9d88c43eea5d75a67a9ee2ecf6b3e4c914d66ded92bbc40d681b5e"
RECOMMENDATION_ID = "legacy-recommendation-0aa5526348f04baa5d1204a6e808883018bb26a4963653984f90103cd14e6e1e"
MIGRATIONS = Path(__file__).resolve().parents[2] / "apps/worker/migrations"


def create_current_snapshot(path, migrations=MIGRATIONS):
    """Create private synthetic current-stage data, reusable by the local CLI smoke."""
    db, _ = taxonomy.canonical(migrations)
    try:
        for name, in db.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall():
            db.execute("DROP TRIGGER " + taxonomy.quote(name))
        db.executescript("""
            DROP VIEW project_search_short_source;
            DROP TABLE project_versions;
            CREATE TABLE project_versions (
                id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
                version_no INTEGER NOT NULL, title TEXT NOT NULL, description TEXT,
                project_type TEXT, extension_type TEXT, project_types TEXT, author_note TEXT,
                tags TEXT NOT NULL DEFAULT '[]', manifest_hash TEXT,
                worldbook_count INTEGER NOT NULL DEFAULT 0, regex_count INTEGER NOT NULL DEFAULT 0,
                schema_version TEXT, discord_thread_url TEXT, created_by TEXT NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL, version_label TEXT, cover_position_x REAL NOT NULL DEFAULT 50,
                cover_position_y REAL NOT NULL DEFAULT 50, cover_zoom REAL NOT NULL DEFAULT 1,
                entry_index TEXT, requirements TEXT, UNIQUE(project_id,version_no), UNIQUE(project_id,id));
            INSERT INTO users VALUES
                ('author','Writer','Displayed writer',NULL,'member','2026-01-01','2026-01-02'),
                ('reviewer','Reviewer',NULL,NULL,'reviewer','2026-01-01','2026-01-02');
            INSERT INTO projects (id,author_id,visibility,working_version_id,published_version_id,
                published_at,published_updated_at,downloads_count,likes_count,subscriptions_count,
                row_version,created_at,updated_at,published_cover_asset_id)
            VALUES ('p','author','public','vw','vp','2026-01-01','2026-01-02',17,1,1,9,
                    '2026-01-01','2026-01-03','cover'),
                   ('p-new','author','private','vn',NULL,NULL,NULL,0,0,0,3,'2026-01-02','2026-01-04',NULL);
        """)
        requirements = taxonomy.stable({"schemaVersion": 1, "dependencies": [], "conflicts": [],
                                        "notes": "Requirements and precautions remain verbatim."})
        worldbook_hash = hashlib.sha256(b"synthetic worldbook reference only").hexdigest()
        manifest = hashlib.sha256(("worldbook:" + worldbook_hash).encode()).hexdigest()
        index = taxonomy.stable({"schemaVersion": 1, "entries": [{"kind": "worldbook", "entryKey": "uid:1",
            "name": "Synthetic entry", "contentHash": "a" * 64, "contentLength": 4}]})
        for identity, project, number, primary, subtype, old_types, tags in (
                ("vp", "p", 1, "系统", None, None, '["cbz","hnh","1011"]'),
                ("vw", "p", 2, "扩展", "规则", '["扩展","事件"]', '["ordinary-custom"]'),
                ("vn", "p-new", 1, "体验优化", None, None, '[]'),
                ("vr", "p-new", 2, "角色", None, None, '[]'),
                ("vc", "p-new", 3, "系统核心", None, None, '[]'),
                ("ve", "p-new", 4, "事件", None, None, '[]'),
                ("vu", "p-new", 5, "unrecognized-historical-value", None, None, '[]')):
            db.execute("INSERT INTO project_versions (id,project_id,version_no,title,description,project_type,"
                       "extension_type,project_types,author_note,tags,manifest_hash,worldbook_count,created_by,"
                       "created_at,version_label,entry_index,requirements,discord_thread_url) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                identity, project, number, "Synthetic " + identity,
                "Unabridged description: author prose is not an author_note field.", primary, subtype,
                old_types, "Agreed obsolete author-note field only.", tags,
                manifest if identity == "vp" else None, 1 if identity == "vp" else 0, "author",
                "2026-01-02", "revision-" + str(number), index if identity == "vp" else None,
                requirements, "https://example.invalid/thread/" + identity))
        db.execute("INSERT INTO assets VALUES ('worldbook','p','vp','worldbook',?,?,?,?,?)",
                   ("projects/existing/source-worldbook.json", worldbook_hash, 32, "application/json", "2026-01-01"))
        db.execute("INSERT INTO assets VALUES ('cover','p',NULL,'cover',?,?,?,?,?)",
                   ("covers/existing/source.webp", "b" * 64, 11, "image/webp", "2026-01-01"))
        db.execute("INSERT INTO assets VALUES ('gallery','p',NULL,'gallery_1',?,?,?,?,?)",
                   ("gallery/p/gallery_1-" + "c" * 64 + ".png", "c" * 64, 12, "image/png", "2026-01-01"))
        db.executescript("""
            INSERT INTO project_likes VALUES ('p','reviewer','2026-01-02');
            INSERT INTO project_subscriptions VALUES ('p','reviewer','2026-01-02');
            INSERT INTO project_ratings VALUES ('p','reviewer',4,'Preserved comment','2026-01-02','2026-01-03');
            INSERT INTO project_metrics_daily VALUES ('2026-01-02','p',13,-1);
            INSERT INTO download_daily_stats VALUES ('reviewer','p','vp','2026-01-02',2,
                '2026-01-02T01:00:00Z','2026-01-02T02:00:00Z','["acq-a","acq-b"]');
            INSERT INTO submissions (id,project_id,version_id,status,submitted_by,submitted_at,
                resolved_at,base_published_version_id)
            VALUES ('approved','p','vp','approved','author','2026-01-01','2026-01-02',NULL),
                   ('pending','p','vw','pending','author','2026-01-03',NULL,'vp');
            INSERT INTO automated_reviews (submission_id,status,attempts,client_gate,report_r2_key,
                report_hash,checked_at) VALUES ('approved','done',2,'pass','reviews/existing/report.json',
                'report-hash','2026-01-02');
            INSERT INTO manual_reviews VALUES ('review','approved','reviewer','approve','Preserved reason',
                'reviewed-manifest','checker-7','2026-01-02');
            INSERT INTO project_change_signals VALUES ('p','vw','vp','old-manifest','new-manifest',1,2,'2026-01-03');
            INSERT INTO recommendation_batches VALUES ('batch','discovery','complete','2026-01-01',
                '2026-01-01','2026-01-02','2026-01-03','2025-12-01','2026-01-01',
                '{"schemaVersion":1,"scoringVersion":"four-pool-v1","items":[]}',NULL);
            INSERT INTO recommendation_batch_activations VALUES ('batch',
                '[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]','2026-01-02',NULL);
            INSERT INTO recommendation_batch_eligibility VALUES ('batch','p','vp',NULL);
            INSERT INTO recommendations VALUES ('curated','reviewer','p','vp','Keep curated history',
                '2026-01-02','2026-01-03');
            INSERT INTO audit_events VALUES ('audit','submission.approved','submission','approved','reviewer',
                '{"kept":"verbatim old taxonomy words: 扩展 and 系统"}','2026-01-02');
            INSERT INTO sessions VALUES ('synthetic-session','author',4,'2026-01-01','2026-01-02','2027-01-01',NULL);
            INSERT INTO oauth_flows (id,state_hash,origin,mode,status,user_id,expires_at,created_at)
                VALUES ('oauth','synthetic-state','https://example.invalid','browser','authorized','author',
                        '2027-01-01','2026-01-01');
            INSERT INTO site_settings VALUES ('synthetic-setting','unchanged value','2026-01-01','reviewer');
        """)
        db.commit()
        taxonomy.private_write(path, b"")
        destination = sqlite3.connect(path)
        try:
            db.backup(destination)
        finally:
            destination.close()
    finally:
        db.close()


def review_current_fixture(document):
    """Explicit decisions for the known synthetic fixture identities only."""
    choices = {"vp": ("系统核心", []), "vw": ("玩法", ["事件"]), "vn": ("体验优化", []),
               "vr": ("角色", []), "vc": ("系统核心", []), "ve": ("事件", []), "vu": ("内容扩展", [])}
    if {row["id"] for row in document["records"]} != set(choices):
        raise ValueError("not the synthetic current snapshot fixture")
    for row in document["records"]:
        primary, included = choices[row["id"]]
        row.update(projectType=primary, includedTypes=included, reviewed=True, tagsAcknowledged=True)
    return document



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
            CREATE TABLE projects (id TEXT, author_id TEXT, name TEXT, description TEXT, status TEXT, is_published INTEGER, visibility INTEGER, created_at TEXT, updated_at TEXT, reviewed_at TEXT, project_type TEXT);
            INSERT INTO projects VALUES ('p1', 'u1', 'Example', 'Description', 'approved', 1, 1, 't1', 't2', 't1', '角色');
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
        self.tables["project_versions"] = [{"id": REVISION, "project_id": "p1", "created_by": "u1", "title": "Example", "description": "Description", "project_type": "角色", "included_types": "[]", "tags": "[]", "entry_index": '{"schemaVersion":1,"entries":[]}', "worldbook_count": 0, "regex_count": 0, "manifest_hash": hashlib.sha256(b"").hexdigest()}]
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

    def reviewed(self, source):
        with taxonomy.snapshot(source) as (db, source_hash):
            review = taxonomy.review_document(db, source_hash, "legacy")
        for row in review["records"]:
            row.update(projectType="玩法" if row["id"] == "draft" else "角色",
                       includedTypes=["内容扩展"] if row["id"] == "draft" else [],
                       reviewed=True, tagsAcknowledged=True)
        return review

    def run_source(self, data=None, dump=None):
        dump = self.dump if dump is None else dump
        source = self.directory / "source.sql"
        source.write_text(dump, encoding="utf-8")
        manifest = self.directory / "manifest.json"
        manifest.write_text(json.dumps({"databases": [{"name": "creative_workshop", "sha256": hashlib.sha256(dump.encode()).hexdigest(), "table_counts": {}}], "buckets": {}}), encoding="utf-8")
        preparation = self.directory / "preparation.json"
        candidate = copy.deepcopy(data if data is not None else self.data)
        if "taxonomy_review" not in candidate:
            candidate["taxonomy_review"] = self.reviewed(source)
        preparation.write_text(json.dumps(candidate), encoding="utf-8")
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
        review_path = self.directory / "review.json"
        review_path.write_text(json.dumps(self.reviewed(source)), encoding="utf-8")
        result = subprocess.run([sys.executable, str(TRANSFORMER), str(source), str(manifest), str(output),
                                 "--review", str(review_path)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(data["diagnostics"], [])
        return data

    def assert_working_revision(self, data, project):
        working = next(row for row in data["tables"]["project_versions"]
                       if row["id"] == project["working_version_id"])
        expected = {
            "title": "Working title", "description": "Working description",
            "project_type": "玩法", "included_types": '["内容扩展"]',
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


class CurrentTaxonomySnapshotTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.source = self.directory / "source.sqlite"
        create_current_snapshot(self.source)
        self.review_path = self.directory / "review.json"
        taxonomy.prepare_review(self.source, "current", self.review_path)

    def reviewed(self):
        review = review_current_fixture(taxonomy.read_review(self.review_path))
        self.review_path.write_text(taxonomy.stable(review), encoding="utf-8")
        return review

    def build(self, name="candidate"):
        output = self.directory / name
        result = taxonomy.build(self.source, self.review_path, MIGRATIONS, output)
        self.assertFalse(result["verified"])
        return output

    def test_populated_snapshot_preserves_new_rows_history_pointers_and_asset_references(self):
        original = self.source.read_bytes()
        self.reviewed()
        candidate = self.build()
        report = taxonomy.verify(self.source, self.review_path, MIGRATIONS, candidate)
        self.assertTrue(report["ok"])
        self.assertEqual(report["tables"]["project_versions"]["rows"], 7)
        self.assertEqual(report["tables"]["submissions"]["rows"], 2)
        self.assertEqual(report["tables"]["download_daily_stats"]["rows"], 1)
        self.assertEqual(report["tables"]["recommendation_batch_eligibility"]["rows"], 1)
        self.assertEqual(self.source.read_bytes(), original)
        with sqlite3.connect(candidate / "expected.sqlite") as db:
            self.assertEqual(db.execute("SELECT working_version_id,published_version_id,published_cover_asset_id,"
                                       "downloads_count,likes_count,row_version FROM projects WHERE id='p'").fetchone(),
                             ("vw", "vp", "cover", 17, 1, 9))
            self.assertIsNone(db.execute("SELECT ended_at FROM recommendation_batch_eligibility").fetchone()[0])
            self.assertEqual(db.execute("SELECT project_type,included_types,tags FROM project_versions WHERE id='vp'").fetchone(),
                             ("系统核心", "[]", '["cbz","hnh","1011"]'))
            self.assertEqual(db.execute("SELECT project_type,included_types FROM project_versions WHERE id='vw'").fetchone(),
                             ("玩法", '["事件"]'))
            self.assertEqual(db.execute("SELECT p.id FROM project_search s JOIN projects p ON p.rowid=s.rowid "
                                        "WHERE project_search MATCH '1011'").fetchall(), [("p",)])
            self.assertFalse(set(taxonomy.columns(db, "project_versions")) & taxonomy.OBSOLETE)

    def test_unresolved_stale_and_altered_accounting_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "unresolved"):
            self.build("unresolved")
        review = self.reviewed()
        altered = copy.deepcopy(review)
        altered["records"][0]["context"]["description"] = "edited evidence"
        self.review_path.write_text(taxonomy.stable(altered), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "altered"):
            self.build("altered")
        self.review_path.write_text(taxonomy.stable(review), encoding="utf-8")
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE project_versions SET description='new source data' WHERE id='vn'")
        with self.assertRaisesRegex(ValueError, "stale"):
            self.build("stale")

    def test_independent_verifier_rejects_candidate_drift(self):
        self.reviewed()
        candidate = self.build()
        path = candidate / "expected.sqlite"
        for sql, restore in (
                ("DELETE FROM download_daily_stats", "INSERT INTO download_daily_stats SELECT * FROM original.download_daily_stats"),
                ("UPDATE projects SET working_version_id='vp' WHERE id='p'", "UPDATE projects SET working_version_id='vw' WHERE id='p'"),
                ("UPDATE project_versions SET description='lost prose' WHERE id='vn'",
                 "UPDATE project_versions SET description=(SELECT description FROM original.project_versions WHERE id='vn') WHERE id='vn'"),
                ("UPDATE project_versions SET project_type='事件' WHERE id='vn'", "UPDATE project_versions SET project_type='体验优化' WHERE id='vn'")):
            with self.subTest(sql=sql):
                with sqlite3.connect(path) as db:
                    db.execute(sql)
                with self.assertRaises(ValueError):
                    taxonomy.verify(self.source, self.review_path, MIGRATIONS, candidate)
                with sqlite3.connect(path) as db:
                    db.execute("ATTACH DATABASE ? AS original", (str(self.source),))
                    db.execute(restore)

    def test_unknown_source_field_is_not_silently_omitted(self):
        with sqlite3.connect(self.source) as db:
            db.execute("ALTER TABLE sessions ADD COLUMN new_stage_detail TEXT")
            db.execute("UPDATE sessions SET new_stage_detail='must survive'")
        self.review_path.unlink()
        taxonomy.prepare_review(self.source, "current", self.review_path)
        self.reviewed()
        with self.assertRaisesRegex(ValueError, "unaccounted source columns"):
            self.build()

    def test_oversized_or_blank_tags_need_explicit_valid_target_and_reason(self):
        old_tags = ["tag-" + str(index) for index in range(21)] + [""]
        with sqlite3.connect(self.source) as db:
            db.execute("UPDATE project_versions SET tags=? WHERE id='vn'", (taxonomy.stable(old_tags),))
        self.review_path.unlink()
        taxonomy.prepare_review(self.source, "current", self.review_path)
        review = self.reviewed()
        with self.assertRaisesRegex(ValueError, "reviewed tags"):
            self.build("invalid-tags")
        record = next(row for row in review["records"] if row["id"] == "vn")
        self.assertEqual(record["tags"]["values"], old_tags)
        record["targetTags"] = ["explicitly-reviewed-tag"]
        self.review_path.write_text(taxonomy.stable(review), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "explicit review explanation"):
            self.build("missing-reason")
        record["tagChangeReason"] = "Synthetic reviewer explicitly replaces invalid historic tags; originals stay pinned here."
        self.review_path.write_text(taxonomy.stable(review), encoding="utf-8")
        candidate = self.build()
        report = taxonomy.verify(self.source, self.review_path, MIGRATIONS, candidate)
        self.assertEqual(report["reviewedTagChanges"], 1)
        self.assertEqual(taxonomy.read_review(candidate / "review.json")["records"], review["records"])

    def test_already_target_snapshot_and_sql_export_preserve_all_business_values(self):
        self.reviewed()
        first = self.build()
        next_source = first / "expected.sqlite"
        next_review = self.directory / "next-review.json"
        taxonomy.prepare_review(next_source, "current", next_review)
        document = taxonomy.read_review(next_review)
        for row in document["records"]:
            row["tagsAcknowledged"] = True
        next_review.write_text(taxonomy.stable(document), encoding="utf-8")
        second = self.directory / "second"
        taxonomy.build(next_source, next_review, MIGRATIONS, second)
        self.assertTrue(taxonomy.verify(next_source, next_review, MIGRATIONS, second)["ok"])
        with taxonomy.snapshot(next_source) as (source, _), taxonomy.snapshot(second / "expected.sqlite") as (target, _):
            for table in taxonomy.logical_tables(source):
                keys = taxonomy.columns(source, table)
                self.assertEqual(taxonomy.row_counts(source, table, keys), taxonomy.row_counts(target, table, keys))
        sql_source = self.directory / "snapshot.sql"
        with sqlite3.connect(self.source) as db:
            sql_source.write_text("\n".join(db.iterdump()) + "\n", encoding="utf-8")
        sql_review = self.directory / "sql-review.json"
        taxonomy.prepare_review(sql_source, "current", sql_review)
        sql_review.write_text(taxonomy.stable(review_current_fixture(taxonomy.read_review(sql_review))), encoding="utf-8")
        sql_candidate = self.directory / "sql-candidate"
        taxonomy.build(sql_source, sql_review, MIGRATIONS, sql_candidate)
        self.assertTrue(taxonomy.verify(sql_source, sql_review, MIGRATIONS, sql_candidate)["ok"])


if __name__ == "__main__":
    unittest.main()

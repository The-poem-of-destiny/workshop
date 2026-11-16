#!/usr/bin/env python3
"""Synthetic backup-to-index reconciliation regressions; no network or private data."""
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
REVISION = "legacy-revision-a49ba8bb2e513b949be40d114a144ced7ad3852164005c4ad1878e10049b787a"
BUCKET = "creative-workshop-projects"
WORLDBOOK = "projects/p1/worldbook.json"
REGEX = "projects/p1/regex-p1.json"
MIGRATIONS = Path(__file__).resolve().parents[2] / "apps/worker/migrations"


def sha(value):
    return hashlib.sha256(value).hexdigest()


class SourceIndexTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.executescript("""
            CREATE TABLE users (id TEXT, username TEXT, global_name TEXT, avatar TEXT, created_at TEXT, updated_at TEXT);
            INSERT INTO users VALUES ('u1', 'synthetic', NULL, NULL, 't1', 't2');
            CREATE TABLE projects (id TEXT, author_id TEXT, name TEXT, description TEXT, status TEXT, is_published INTEGER, visibility INTEGER, download_url TEXT, created_at TEXT, updated_at TEXT, project_type TEXT, cover_position_x REAL, cover_position_y REAL, cover_zoom REAL);
            INSERT INTO projects VALUES ('p1', 'u1', 'Example', 'Description', 'approved', 1, 1, 'projects/p1/worldbook.json', 't1', 't2', '角色', 50, 50, 1);
        """)
        for table in ("project_likes", "project_subscribes", "project_ratings", "project_metric_daily",
                      "daily_random_draw_state", "devteam_recommendations", "admins", "super_admins",
                      "character_references", "character_reference_versions", "character_reference_items",
                      "site_settings", "admin_action_logs", "project_metadata_audit_logs", "discovery_feature_history"):
            db.execute('CREATE TABLE "' + table + '" (id TEXT)')
        self.dump = "\n".join(db.iterdump()) + "\n"
        self.payloads = {
            WORLDBOOK: json.dumps({"entries": [{"uid": 7, "name": "Named entry", "content": "A\U0001f600"},
                                               {"comment": "Fallback entry", "content": "second"}]}).encode(),
            REGEX: b'[{"id":"r1","scriptName":"Replacement","replaceString":"B"}]',
        }
        tables = {name: [] for name in (
            "users", "projects", "project_versions", "project_likes", "project_subscriptions",
            "project_ratings", "project_metrics_daily", "site_settings", "audit_events", "recommendations", "assets", "version_entry_index")}
        tables["users"] = [{"id": "u1", "username": "synthetic", "global_name": None, "avatar": None,
                            "role": "member", "created_at": "t1", "updated_at": "t2"}]
        tables["projects"] = [{"id": "p1", "author_id": "u1", "working_version_id": REVISION,
                               "published_version_id": REVISION, "visibility": "public", "title": "Example",
                               "description": "Description", "search_tags": "[]", "published_at": None,
                               "downloads_count": 0, "likes_count": 0, "subscriptions_count": 0,
                               "created_at": "t1", "updated_at": "t2"}]
        tables["project_versions"] = [{"id": REVISION, "project_id": "p1", "version_no": 1,
                                        "created_by": "u1", "created_at": "t1", "cover_position_x": 50,
                                        "cover_position_y": 50, "cover_zoom": 1,
                                        "title": "Example", "description": "Description", "project_type": "角色", "included_types": "[]", "tags": "[]",
                                        "entry_index_ready": 1, "worldbook_count": 2, "regex_count": 1}]
        tables["version_entry_index"] = [
            {"version_id": REVISION, "kind": "worldbook", "entry_key": "uid:7", "name": "Named entry",
             "content_hash": sha("A\U0001f600".encode()), "content_length": 2},
            {"version_id": REVISION, "kind": "worldbook", "entry_key": "index:1", "name": "Fallback entry",
             "content_hash": sha(b"second"), "content_length": 6},
            {"version_id": REVISION, "kind": "regex", "entry_key": "id:r1", "name": "Replacement",
             "content_hash": sha(b"B"), "content_length": 1},
        ]
        self.data = {"format": "workshop-full-migration-preparation-v1", "tables": tables,
                     "diagnostics": [], "omissions": [], "objects": []}
        self.sync_assets()

    def sync_assets(self, omitted_kinds=()):
        assets = []
        objects = []
        for key, payload in self.payloads.items():
            kind = "regex" if key == REGEX else "worldbook"
            if kind in omitted_kinds:
                continue
            digest = sha(payload)
            target = "projects/imported/" + digest
            assets.append({"id": "legacy-asset-" + sha(taxonomy.stable([REVISION, kind]).encode()),
                           "project_id": "p1", "version_id": REVISION, "kind": kind,
                           "r2_key": target, "sha256": digest, "bytes": len(payload),
                           "mime": "application/json", "created_at": "t1"})
            objects.append({"sourceBucket": BUCKET, "sourceKey": key, "targetKey": target,
                            "sha256": digest, "bytes": len(payload)})
        self.data["tables"]["assets"] = assets
        self.data["objects"] = list({item["targetKey"]: item for item in objects}.values())
        hashes = "\n".join(asset["kind"] + ":" + asset["sha256"] for asset in sorted(assets, key=lambda item: item["kind"]))
        self.data["tables"]["project_versions"][0]["manifest_hash"] = sha(hashes.encode())

    def run_source(self, data=None, tampered=None):
        source = self.directory / "source.sql"
        source.write_text(self.dump, encoding="utf-8")
        objects = []
        for key, payload in self.payloads.items():
            path = self.directory / "r2" / BUCKET / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload if tampered is None or key not in tampered else tampered[key])
            objects.append({"key": key, "sha256": sha(payload), "size": len(payload)})
        manifest = self.directory / "manifest.json"
        manifest.write_text(json.dumps({
            "databases": [{"name": "creative_workshop", "sha256": sha(self.dump.encode()), "table_counts": {}}],
            "buckets": {BUCKET: {"objects": objects}},
        }), encoding="utf-8")
        preparation = self.directory / "preparation.json"
        candidate = copy.deepcopy(self.data if data is None else data)
        with taxonomy.snapshot(source) as (db, source_hash):
            candidate["taxonomy_review"] = taxonomy.review_document(db, source_hash, "legacy")
        for row in candidate["taxonomy_review"]["records"]:
            row.update(reviewed=True, tagsAcknowledged=True)
        index_rows = candidate["tables"].pop("version_entry_index")
        for version in candidate["tables"]["project_versions"]:
            ready = version.pop("entry_index_ready")
            version["entry_index"] = taxonomy.stable({"schemaVersion": 1, "entries": sorted([
                {"kind": row["kind"], "entryKey": row["entry_key"], "name": row["name"],
                 "contentHash": row["content_hash"], "contentLength": row["content_length"]}
                for row in index_rows if row["version_id"] == version["id"]],
                key=lambda entry: (entry["kind"], entry["entryKey"]))}) if ready else None
        preparation.write_text(json.dumps(candidate), encoding="utf-8")
        result = subprocess.run([sys.executable, str(LOADER), "source", str(preparation), str(source), str(manifest)],
                                capture_output=True, text=True, check=False)
        self.assertTrue(result.stdout, result.stderr)
        return result, json.loads(result.stdout)

    def imported_snapshot(self, name, *, private_invalid=False, identity="p1", user_updated_at="t2", content_type=None, split_published=False):
        """Build an actual, independently accepted original-backup import."""
        root = self.directory / name
        root.mkdir(mode=0o700)
        source = root / "source.sql"
        key = "projects/" + identity + "/worldbook.json"
        payload = b"{" if private_invalid else b'{"entries":[{"uid":7,"content":"a"},{"uid":7,"content":"b"}]}'
        with sqlite3.connect(":memory:") as db:
            db.executescript(self.dump)
            for column in ("reviewed_at TEXT", "tags TEXT"):
                db.execute("ALTER TABLE projects ADD COLUMN " + column)
            db.execute("UPDATE users SET updated_at=?", (user_updated_at,))
            db.execute("UPDATE projects SET id=?, download_url=?, visibility=?, reviewed_at='t1', "
                       "cover_position_x=50, cover_position_y=50, cover_zoom=1, project_type='系统', tags='[\"人类\"]'",
                       (identity, key, 0 if private_invalid else 1))
            if split_published:
                for column in ("root_project_id TEXT", "draft_project_id TEXT", "published_project_id TEXT"):
                    db.execute("ALTER TABLE projects ADD COLUMN " + column)
                fields = [row[1] for row in db.execute("PRAGMA table_info(projects)")]
                published = dict(zip(fields, db.execute("SELECT * FROM projects").fetchone()))
                # The root sorts before this lexicographically earlier published ID.
                published.update(id="a-published", root_project_id=identity, created_at="t0")
                db.execute("INSERT INTO projects (" + ",".join(map(taxonomy.quote, fields)) + ") VALUES ("
                           + ",".join("?" for _ in fields) + ")", [published[field] for field in fields])
                db.execute("UPDATE projects SET draft_project_id=?,published_project_id=?,is_published=0,visibility=0 WHERE id=?",
                           (identity, "a-published", identity))
            taxonomy.private_write(source, ("\n".join(db.iterdump()) + "\n").encode())
        backup = root / "r2" / BUCKET / key
        backup.parent.mkdir(mode=0o700, parents=True)
        taxonomy.private_write(backup, payload)
        manifest = root / "manifest.json"
        taxonomy.json_write(manifest, {
            "databases": [{"name": "creative_workshop", "sha256": taxonomy.file_hash(source), "table_counts": {}}],
            "buckets": {BUCKET: {"objects": [{"key": key, "sha256": sha(payload), "size": len(payload),
                                               "local_path": str(backup.relative_to(root)),
                                               **({"http_metadata": {"contentType": content_type}} if content_type is not None else {})}]}},
        })
        review_path = root / "legacy-review.json"
        taxonomy.prepare_review(source, "legacy", review_path)
        document = taxonomy.read_review(review_path)
        for row in document["records"]:
            row.update(reviewed=True, tagsAcknowledged=True)
        review_path.write_text(taxonomy.stable(document), encoding="utf-8")
        preparation = root / "preparation.json"
        transformed = subprocess.run([sys.executable, str(Path(__file__).with_name("full-transform.py")),
            str(source), str(manifest), str(preparation), "--review", str(review_path)],
            capture_output=True, text=True, check=False)
        self.assertEqual(transformed.returncode, 0, transformed.stderr)
        data = taxonomy.read_review(preparation)
        self.assertEqual(data["diagnostics"], [])
        planner = taxonomy.module("imported_exception_fixture_planner", "multiday-plan.py")
        self.assertTrue(planner.loader.source_reconcile(data, source, manifest)["ok"])
        self.assertTrue(planner.validator.validate(data, MIGRATIONS)["ok"])
        imported = root / "imported"
        planner.build(preparation, source, manifest, MIGRATIONS, imported)
        planner.validate_plan(imported / "plan.json")
        current = root / "current.sqlite"
        taxonomy.private_write(current, (imported / "expected.sqlite").read_bytes())
        return current, (preparation, source, manifest), backup

    def current_review(self, source, name):
        review_path = self.directory / (name + "-current-review.json")
        taxonomy.prepare_review(source, "current", review_path)
        document = taxonomy.read_review(review_path)
        self.assertTrue(all(row["reviewed"] is False and row["tagsAcknowledged"] is False for row in document["records"]))
        for row in document["records"]:
            row.update(reviewed=True, tagsAcknowledged=True)
        review_path.write_text(taxonomy.stable(document), encoding="utf-8")
        return review_path

    def export_current_sql(self, source):
        """Dump declared tables and logical FTS rows, not virtual-table storage pages."""
        stage = taxonomy.module("index_fixture_sql", "d1-data.py")
        output = source.with_suffix(".sql")
        with taxonomy.snapshot(source) as (db, _):
            metadata = list(db.execute("PRAGMA table_list"))
            tables = {row["name"] for row in metadata
                      if row["schema"] == "main" and row["type"] in ("table", "virtual")
                      and not row["name"].startswith("sqlite_")}
            shadows = {row["name"] for row in metadata if row["type"] == "shadow"}
            schema_sql = "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name"
            definitions = [tuple(row) for row in db.execute(schema_sql) if row["name"] not in shadows]
            statements = ["PRAGMA foreign_keys=OFF;", "BEGIN;"]
            statements.extend(sql + ";" for kind, _, sql in definitions if kind == "table")
            for table in sorted(tables):
                fields = ["rowid", *[row["name"] for row in db.execute("PRAGMA table_info(" + taxonomy.quote(table) + ")")]]
                field_sql = ",".join(map(taxonomy.quote, fields))
                for row in db.execute("SELECT " + field_sql + " FROM " + taxonomy.quote(table) + " ORDER BY rowid"):
                    values = ",".join("X'" + value.hex() + "'" if isinstance(value, bytes) else stage.value(value)
                                      for value in row)
                    statements.append("INSERT INTO " + taxonomy.quote(table) + " (" + field_sql + ") VALUES (" + values + ");")
            statements.extend(sql + ";" for kind, _, sql in definitions if kind != "table")
            statements.append("COMMIT;")
            taxonomy.private_write(output, ("\n".join(statements) + "\n").encode())
            with taxonomy.snapshot(output) as (restored, _):
                restored_shadows = {row["name"] for row in restored.execute("PRAGMA table_list") if row["type"] == "shadow"}
                self.assertEqual([tuple(row) for row in restored.execute(schema_sql) if row["name"] not in restored_shadows],
                                 definitions)
                for table in sorted(tables):
                    query = "SELECT rowid,* FROM " + taxonomy.quote(table) + " ORDER BY rowid"
                    expected = [tuple((type(value).__name__, value) for value in row) for row in db.execute(query)]
                    actual = [tuple((type(value).__name__, value) for value in row) for row in restored.execute(query)]
                    self.assertEqual(actual, expected, table)
                for table, term in (("project_search", "Example"), ("project_search_short", "E")):
                    query = "SELECT rowid FROM " + table + " WHERE " + table + " MATCH ? ORDER BY rowid"
                    expected = [tuple(row) for row in db.execute(query, (term,))]
                    self.assertEqual(len(expected), 1, table)
                    self.assertEqual([tuple(row) for row in restored.execute(query, (term,))], expected, table)
        return output

    def taxonomy_cli(self, *arguments, expected_exit=0):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("offline.py")), "taxonomy",
                                 *map(str, arguments)], capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, expected_exit, (arguments, result.stdout, result.stderr))
        report = json.loads(result.stdout)
        if expected_exit:
            self.assertEqual(report, {"ok": False, "error": "unresolved_stale_or_invalid_taxonomy_inputs"})
        else:
            self.assertTrue(report["ok"])
        return report


    def assert_difference(self, data, check):
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 1, (result.stderr, report))
        self.assertFalse(report["ok"])
        self.assertIn({"kind": "source_difference", "check": check}, report["failures"])

    def test_verified_source_indexes_are_accepted(self):
        result, report = self.run_source()
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        self.assertTrue(report["ok"])
        self.assertEqual(report["checks"]["version_entry_index"],
                         {"expected": 3, "actual": 3, "missing": 0, "extra": 0})

    def test_missing_extra_or_corrupted_index_rows_are_rejected(self):
        for mutation in ("missing", "extra", "kind", "entry_key", "name", "content_hash", "content_length", "version_id"):
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(self.data)
                rows = data["tables"]["version_entry_index"]
                if mutation == "missing":
                    rows.pop()
                elif mutation == "extra":
                    rows.append(copy.deepcopy(rows[0]))
                else:
                    rows[0][mutation] = 99 if mutation == "content_length" else "tampered"
                self.assert_difference(data, "version_entry_index")

    def test_forged_readiness_counts_and_exclusions_cannot_hide_valid_entries(self):
        for mutation in ("readiness", "worldbook_count", "regex_count", "manifest_hash", "duplicate", "invalid", "no_content"):
            with self.subTest(mutation=mutation):
                data = copy.deepcopy(self.data)
                revision = data["tables"]["project_versions"][0]
                if mutation in ("worldbook_count", "regex_count", "manifest_hash"):
                    revision[mutation] = "tampered" if mutation == "manifest_hash" else 0
                else:
                    revision.update(entry_index_ready=0, worldbook_count=0, regex_count=0)
                    data["tables"]["version_entry_index"].clear()
                    if mutation in ("duplicate", "invalid"):
                        reason = ("content index unavailable: duplicate entry keys" if mutation == "duplicate"
                                  else "invalid content asset omitted: forged")
                        data["omissions"].append({"table": "projects", "reason": reason,
                                                 "source": {"id": "p1", "kind": "worldbook", "sha256": sha(self.payloads[WORLDBOOK])}})
                    elif mutation == "no_content":
                        data["tables"]["assets"].clear()
                        data["objects"].clear()
                        data["omissions"].append({"table": "projects", "source": {"id": "p1"},
                                                 "reason": "source revision has no content asset"})
                self.assert_difference(data, "revision_content_readiness")

    def test_original_object_integrity_is_required(self):
        for payload in (b"x" * len(self.payloads[WORLDBOOK]), self.payloads[WORLDBOOK] + b" "):
            with self.subTest(size=len(payload)):
                result, report = self.run_source(tampered={WORLDBOOK: payload})
                self.assertEqual(result.returncode, 1, (result.stderr, report))
                self.assertIn({"kind": "source_object_integrity_failed", "asset_kind": "worldbook"}, report["failures"])

    def test_real_duplicate_keys_require_incomplete_revision_and_no_index(self):
        self.payloads[WORLDBOOK] = b'{"entries":[{"uid":7,"content":"a"},{"uid":7,"content":"b"}]}'
        self.sync_assets()
        self.data["tables"]["project_versions"][0].update(entry_index_ready=0, worldbook_count=0, regex_count=0)
        self.data["tables"]["project_versions"][0].pop("manifest_hash")
        self.data["tables"]["version_entry_index"].clear()
        self.data["omissions"].append({"table": "projects", "reason": "content index unavailable: duplicate entry keys",
                                       "source": {"id": "p1", "kind": "worldbook", "sha256": sha(self.payloads[WORLDBOOK])}})
        result, report = self.run_source()
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        self.assertEqual(report["incomplete_content_revisions"], 1)
        data = copy.deepcopy(self.data)
        data["tables"]["project_versions"][0]["entry_index_ready"] = 1
        self.assert_difference(data, "revision_content_readiness")

    def test_verified_zero_byte_and_duplicate_worldbook_exclusions(self):
        for omission in ("zero-byte", "duplicate"):
            with self.subTest(omission=omission):
                self.payloads[WORLDBOOK] = b"" if omission == "zero-byte" else self.payloads[REGEX]
                self.sync_assets(omitted_kinds={"worldbook"})
                self.data["tables"]["project_versions"][0]["worldbook_count"] = 0
                self.data["tables"]["version_entry_index"] = [
                    row for row in self.data["tables"]["version_entry_index"] if row["kind"] == "regex"]
                if omission == "zero-byte":
                    excluded = {"table": "r2", "reason": "zero-byte worldbook omitted",
                                "source": {"bucket": BUCKET, "key": WORLDBOOK}}
                else:
                    excluded = {"table": "projects", "reason": "worldbook duplicates validated regex asset",
                                "source": {"id": "p1", "sha256": sha(self.payloads[WORLDBOOK])}}
                    self.data["objects"][0]["sourceKey"] = WORLDBOOK
                self.data["omissions"] = [excluded]
                result, report = self.run_source()
                self.assertEqual(result.returncode, 0, (result.stderr, report))
                result, report = self.run_source(tampered={WORLDBOOK: b"tampered"})
                self.assertEqual(result.returncode, 1, (result.stderr, report))
                self.assertIn({"kind": "source_object_integrity_failed", "asset_kind": "worldbook"}, report["failures"])

    def test_invalid_content_exclusion_requires_the_real_parser_failure(self):
        self.payloads[WORLDBOOK] = b"{"
        self.sync_assets(omitted_kinds={"worldbook"})
        self.data["tables"]["project_versions"][0]["worldbook_count"] = 0
        self.data["tables"]["version_entry_index"] = [
            row for row in self.data["tables"]["version_entry_index"] if row["kind"] == "regex"]
        self.data["omissions"] = [{"table": "projects",
                                  "reason": "invalid content asset omitted: \u9879\u76ee JSON \u65e0\u6cd5\u89e3\u6790",
                                  "source": {"id": "p1", "kind": "worldbook", "sha256": sha(b"{")}}]
        result, report = self.run_source()
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        data = copy.deepcopy(self.data)
        data["omissions"][0]["reason"] = "invalid content asset omitted: forged"
        self.assert_difference(data, "invalid_content_exclusions")


    def test_current_taxonomy_preserves_verified_import_exceptions_for_sqlite_and_sql(self):
        cases = ((False, None, False), (True, None, False),
                 (False, "application/vnd.workshop+json", True))
        for private_invalid, content_type, split_published in cases:
            with self.subTest(private_invalid=private_invalid, content_type=content_type, split_published=split_published):
                label = "invalid" if private_invalid else "explicit-split" if split_published else "duplicate"
                current, provenance, backup = self.imported_snapshot(
                    label, private_invalid=private_invalid, content_type=content_type, split_published=split_published)
                with sqlite3.connect(current) as db:
                    published_id, = db.execute("SELECT published_version_id FROM projects").fetchone()
                    self.assertEqual(db.execute("SELECT version_no,created_at,schema_version FROM project_versions WHERE id=?",
                                                (published_id,)).fetchone(), (2, "t0", None) if split_published else (1, "t1", None))
                    if split_published:
                        self.assertEqual(db.execute("SELECT version_no FROM project_versions WHERE id=?", (REVISION,)).fetchone(), (1,))
                    for mime, created_at in db.execute("SELECT mime,created_at FROM assets WHERE version_id=?", (published_id,)):
                        self.assertEqual((mime, created_at), (content_type or "application/json", "t0" if split_published else "t1"))
                    # Later working state, counters and history belong to the current snapshot.
                    db.execute("INSERT INTO project_versions (id,project_id,version_no,title,project_type,created_by,created_at) "
                               "VALUES ('new-working','p1',3,'Later working state','角色','u1','t3')")
                    db.execute("UPDATE projects SET working_version_id='new-working', downloads_count=17, "
                               "row_version=9, updated_at='t3'")
                    db.execute("INSERT INTO audit_events VALUES ('later-audit','project.patch','project','p1','u1','{}','t3')")
                source_hashes = {str(path): taxonomy.file_hash(path) for path in (*provenance, backup)}
                sql_source = self.export_current_sql(current)
                for source in (current, sql_source):
                    name = label + "-" + source.suffix[1:]
                    original_hash = taxonomy.file_hash(source)
                    review = self.directory / (name + "-current-review.json")
                    prepared = self.taxonomy_cli("prepare-review", "--source", source, "--source-kind", "current", "--output", review)
                    document = taxonomy.read_review(review)
                    self.assertEqual(prepared["unresolved"], len(document["records"]))
                    self.assertTrue(all(row["reviewed"] is False and row["tagsAcknowledged"] is False for row in document["records"]))
                    for row in document["records"]:
                        row.update(projectType="玩法", includedTypes=["事件"], reviewed=True, tagsAcknowledged=True)
                    review.write_text(taxonomy.stable(document), encoding="utf-8")
                    without_evidence = self.directory / (name + "-no-provenance")
                    self.taxonomy_cli("build", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                      "--output", without_evidence, expected_exit=1)
                    self.assertFalse(without_evidence.exists())
                    candidate = self.directory / (name + "-candidate")
                    built = self.taxonomy_cli("build", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                              "--output", candidate, "--legacy-provenance", *provenance)
                    self.assertFalse(built["verified"])
                    self.taxonomy_cli("verify", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                      "--candidate", candidate, expected_exit=1)
                    report = self.taxonomy_cli("verify", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                               "--candidate", candidate, "--legacy-provenance", *provenance)
                    self.assertTrue(report["ok"])
                    self.assertEqual(report["legacySources"], 1)
                    self.assertEqual(report["acceptedImportedExceptions"], [{
                        "kind": "private_invalid_content_omitted" if private_invalid else "published_duplicate_entry_keys",
                        "count": 1, "source_verification_required": True}])
                    with sqlite3.connect(candidate / "expected.sqlite") as db:
                        self.assertEqual(db.execute("SELECT working_version_id,downloads_count,row_version,updated_at FROM projects").fetchone(),
                                         ("new-working", 17, 9, "t3"))
                        self.assertEqual(db.execute("SELECT entry_index,manifest_hash,worldbook_count,regex_count "
                                                   "FROM project_versions WHERE id=?", (published_id,)).fetchone(), (None, None, 0, 0))
                        self.assertEqual(db.execute("SELECT detail FROM audit_events WHERE id='later-audit'").fetchone(), ("{}",))
                    self.assertEqual(taxonomy.file_hash(source), original_hash)
                self.assertEqual({str(path): taxonomy.file_hash(path) for path in (*provenance, backup)}, source_hashes)

    def test_metadata_comparison_uses_canonical_storage_defaults_and_types(self):
        data = copy.deepcopy(self.data)
        version, = data["tables"]["project_versions"]
        version.update(version_no="1", created_at="t1", schema_version=None,
                       cover_position_x="50", cover_position_y="50", cover_zoom="1")
        for asset in data["tables"]["assets"]:
            asset["bytes"] = str(asset["bytes"])
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        self.assertTrue(report["ok"])
        for field in ("cover_position_x", "cover_position_y", "cover_zoom", "schema_version"):
            version.pop(field)
        result, report = self.run_source(data)
        self.assertEqual(result.returncode, 0, (result.stderr, report))
        self.assertTrue(report["ok"])
        version["schema_version"] = 1
        self.assert_difference(data, "current_revisions")

    def test_coordinated_metadata_changes_cannot_inherit_imported_exceptions(self):
        current, provenance, backup = self.imported_snapshot("metadata-authority")
        preparation, source_sql, manifest = provenance
        originals = {str(path): taxonomy.file_hash(path) for path in (current, *provenance, backup)}
        original_review = self.current_review(current, "metadata-authority")
        original_candidate = self.directory / "metadata-original-candidate"
        self.taxonomy_cli("build", "--source", current, "--review", original_review, "--migrations", MIGRATIONS,
                          "--output", original_candidate, "--legacy-provenance", *provenance)
        planner = taxonomy.module("metadata_authority_planner", "multiday-plan.py")
        canonical, migration_pins = taxonomy.canonical(MIGRATIONS)
        canonical.close()
        changes = (("assets", "id", "changed-asset-id"),
                   ("assets", "mime", "text/plain"),
                   ("assets", "created_at", "changed-asset-time"),
                   ("project_versions", "version_no", 7),
                   ("project_versions", "created_at", "changed-version-time"),
                   ("project_versions", "schema_version", "changed-schema-version"))
        for table, field, value in changes:
            name = table + "-" + field
            changed = self.directory / (name + ".sqlite")
            taxonomy.private_write(changed, current.read_bytes())
            predicate = "version_id" if table == "assets" else "id"
            with sqlite3.connect(changed) as db:
                db.execute("UPDATE " + taxonomy.quote(table) + " SET " + taxonomy.quote(field)
                           + "=? WHERE " + taxonomy.quote(predicate) + "=?", (value, REVISION))
            forged_data = taxonomy.read_review(preparation)
            next(row for row in forged_data["tables"][table] if row[predicate] == REVISION)[field] = value
            forged_preparation = self.directory / (name + "-preparation.json")
            taxonomy.json_write(forged_preparation, forged_data)
            forged_provenance = (forged_preparation, source_sql, manifest)
            for source in (changed, self.export_current_sql(changed)):
                with self.subTest(table=table, field=field, source=source.suffix):
                    label = name + "-" + source.suffix[1:]
                    review = self.current_review(source, label)
                    before = {str(path): taxonomy.file_hash(path) for path in (source, *forged_provenance, backup)}
                    for suffix, supplied in (("current-only", provenance), ("coordinated", forged_provenance)):
                        output = self.directory / (label + "-" + suffix)
                        self.taxonomy_cli("build", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                          "--output", output, "--legacy-provenance", *supplied, expected_exit=1)
                        self.assertFalse(output.exists())
                    # Recreate an older candidate and fresh public pins, so verify
                    # must authenticate original facts instead of only noticing staleness.
                    candidate = self.directory / (label + "-prebuilt-candidate")
                    candidate.mkdir(mode=0o700)
                    taxonomy.private_write(candidate / "expected.sqlite", (original_candidate / "expected.sqlite").read_bytes())
                    with sqlite3.connect(candidate / "expected.sqlite") as db:
                        db.execute("UPDATE " + taxonomy.quote(table) + " SET " + taxonomy.quote(field)
                                   + "=? WHERE " + taxonomy.quote(predicate) + "=?", (value, REVISION))
                    taxonomy.json_write(candidate / "review.json", taxonomy.read_review(review))
                    pins = taxonomy.legacy_provenance_inputs([forged_provenance], MIGRATIONS, planner)
                    taxonomy.json_write(candidate / "candidate.json",
                                        taxonomy.pinned_inputs(taxonomy.file_hash(source), review, migration_pins, pins))
                    self.taxonomy_cli("verify", "--source", source, "--review", review, "--migrations", MIGRATIONS,
                                      "--candidate", candidate, "--legacy-provenance", *forged_provenance, expected_exit=1)
                    self.assertEqual({str(path): taxonomy.file_hash(path) for path in (source, *forged_provenance, backup)}, before)
        self.assertEqual({str(path): taxonomy.file_hash(path) for path in (current, *provenance, backup)}, originals)

    def test_unmapped_canonical_metadata_fails_closed_with_fresh_pins(self):
        current, provenance, backup = self.imported_snapshot("schema-authority")
        preparation, source_sql, manifest = provenance
        originals = {str(path): taxonomy.file_hash(path) for path in (current, *provenance, backup)}
        original_review = self.current_review(current, "schema-authority")
        original_candidate = self.directory / "schema-original-candidate"
        self.taxonomy_cli("build", "--source", current, "--review", original_review, "--migrations", MIGRATIONS,
                          "--output", original_candidate, "--legacy-provenance", *provenance)
        planner = taxonomy.module("schema_authority_planner", "multiday-plan.py")
        for table in ("assets", "project_versions"):
            with self.subTest(table=table):
                migrations = self.directory / (table + "-migrations")
                migrations.mkdir(mode=0o700)
                for path in MIGRATIONS.glob("*.sql"):
                    taxonomy.private_write(migrations / path.name, path.read_bytes())
                alteration = "ALTER TABLE " + taxonomy.quote(table) + " ADD COLUMN unaccounted_metadata TEXT;"
                taxonomy.private_write(migrations / "0002_unmapped.sql", alteration.encode())
                changed = self.directory / (table + "-unmapped.sqlite")
                taxonomy.private_write(changed, current.read_bytes())
                with sqlite3.connect(changed) as db:
                    db.execute(alteration)
                    db.execute("UPDATE " + taxonomy.quote(table) + " SET unaccounted_metadata='changed'")
                data = taxonomy.read_review(preparation)
                for row in data["tables"][table]:
                    row["unaccounted_metadata"] = "changed"
                forged = self.directory / (table + "-unmapped-preparation.json")
                taxonomy.json_write(forged, data)
                supplied = (forged, source_sql, manifest)
                review = self.current_review(changed, table + "-unmapped")
                output = self.directory / (table + "-unmapped-output")
                self.taxonomy_cli("build", "--source", changed, "--review", review, "--migrations", migrations,
                                  "--output", output, "--legacy-provenance", *supplied, expected_exit=1)
                self.assertFalse(output.exists())
                candidate = self.directory / (table + "-unmapped-prebuilt")
                candidate.mkdir(mode=0o700)
                taxonomy.private_write(candidate / "expected.sqlite", (original_candidate / "expected.sqlite").read_bytes())
                with sqlite3.connect(candidate / "expected.sqlite") as db:
                    db.execute(alteration)
                    db.execute("UPDATE " + taxonomy.quote(table) + " SET unaccounted_metadata='changed'")
                canonical, migration_pins = taxonomy.canonical(migrations)
                canonical.close()
                taxonomy.json_write(candidate / "review.json", taxonomy.read_review(review))
                pins = taxonomy.legacy_provenance_inputs([supplied], migrations, planner)
                taxonomy.json_write(candidate / "candidate.json",
                                    taxonomy.pinned_inputs(taxonomy.file_hash(changed), review, migration_pins, pins))
                self.taxonomy_cli("verify", "--source", changed, "--review", review, "--migrations", migrations,
                                  "--candidate", candidate, "--legacy-provenance", *supplied, expected_exit=1)
        self.assertEqual({str(path): taxonomy.file_hash(path) for path in (current, *provenance, backup)}, originals)

    def test_imported_exception_provenance_and_identity_fail_closed_before_output(self):
        current, provenance, backup = self.imported_snapshot("negative")
        review = self.current_review(current, "negative-original")
        candidate = self.directory / "negative-candidate"
        taxonomy.build(current, review, MIGRATIONS, candidate, [provenance])
        preparation, source_sql, manifest = provenance
        for path in provenance + (backup,):
            with self.subTest(tampered=path.name):
                raw = path.read_bytes()
                path.write_bytes(raw + b" ")
                with self.assertRaisesRegex(ValueError, "stale candidate"):
                    taxonomy.verify(current, review, MIGRATIONS, candidate, legacy_provenance=[provenance])
                path.write_bytes(raw)
        invalid_provenance = []
        forged = self.directory / "forged-preparation.json"
        data = taxonomy.read_review(preparation)
        omission = next(item for item in data["omissions"] if item["reason"] == "content index unavailable: duplicate entry keys")
        omission["source"]["sha256"] = "0" * 64
        taxonomy.json_write(forged, data)
        invalid_provenance.append(("forged-omission", [(forged, source_sql, manifest)]))
        data["taxonomy_review"]["records"][0]["reviewed"] = False
        unresolved = self.directory / "unresolved-preparation.json"
        taxonomy.json_write(unresolved, data)
        invalid_provenance.append(("unreviewed-original", [(unresolved, source_sql, manifest)]))
        invalid_provenance.append(("duplicate-original", [provenance, provenance]))
        invalid_provenance.append(("sqlite-not-original-sql", [(preparation, current, manifest)]))
        for name, supplied in invalid_provenance:
            with self.subTest(provenance=name):
                output = self.directory / name
                with self.assertRaises(ValueError):
                    taxonomy.build(current, review, MIGRATIONS, output, supplied)
                self.assertFalse(output.exists())
        for path in provenance:
            sidecar = Path(str(path) + "-wal")
            taxonomy.private_write(sidecar, b"uncheckpointed")
            output = self.directory / (path.name + "-sidecar")
            with self.assertRaisesRegex(ValueError, "without sidecars"):
                taxonomy.build(current, review, MIGRATIONS, output, [provenance])
            self.assertFalse(output.exists())
            sidecar.unlink()
        attached = self.directory / "attached.sql"
        sentinel = self.directory / "unrelated.sqlite"
        attached.write_bytes(source_sql.read_bytes() + ("ATTACH DATABASE '" + str(sentinel) + "' AS unrelated;\n").encode())
        attached_manifest = self.directory / "attached-manifest.json"
        manifest_data = taxonomy.read_review(manifest)
        manifest_data["databases"][0]["sha256"] = taxonomy.file_hash(attached)
        taxonomy.json_write(attached_manifest, manifest_data)
        with self.assertRaises(sqlite3.DatabaseError):
            taxonomy.build(current, review, MIGRATIONS, self.directory / "attach-rejected",
                           [(preparation, attached, attached_manifest)])
        self.assertFalse(sentinel.exists())
        for index, sql in enumerate((
                "UPDATE project_versions SET description='changed immutable prose' WHERE id='" + REVISION + "'",
                "UPDATE assets SET id='changed-asset-id' WHERE version_id='" + REVISION + "'",
                "INSERT INTO assets SELECT 'extra-asset',project_id,version_id,'regex',r2_key,sha256,bytes,mime,created_at FROM assets",
                "UPDATE projects SET published_at='changed-publication-time'",
                "UPDATE projects SET id='different-project'; UPDATE project_versions SET project_id='different-project'; UPDATE assets SET project_id='different-project'")):
            with self.subTest(identity=sql):
                changed = self.directory / ("changed-" + str(index) + ".sqlite")
                taxonomy.private_write(changed, current.read_bytes())
                with sqlite3.connect(changed) as db:
                    for trigger, in db.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall():
                        db.execute("DROP TRIGGER " + taxonomy.quote(trigger))
                    db.executescript(sql)
                changed_review = self.current_review(changed, "changed-" + str(index))
                output = self.directory / ("changed-output-" + str(index))
                with self.assertRaisesRegex(ValueError, "identity changed|asset rows changed"):
                    taxonomy.build(changed, changed_review, MIGRATIONS, output, [provenance])
                self.assertFalse(output.exists())
        private, private_provenance, _ = self.imported_snapshot("private-negative", private_invalid=True)
        with sqlite3.connect(private) as db:
            db.execute("UPDATE projects SET visibility='public'")
        private_review = self.current_review(private, "private-turned-public")
        with self.assertRaisesRegex(ValueError, "application integrity"):
            taxonomy.build(private, private_review, MIGRATIONS, self.directory / "invalid-public", [private_provenance])
        self.assertFalse((self.directory / "invalid-public").exists())

    def test_multiple_import_provenance_is_order_independent_and_conflicts_are_rejected(self):
        first, first_provenance, _ = self.imported_snapshot("first-import")
        second, second_provenance, _ = self.imported_snapshot("second-import", identity="p2", private_invalid=True)
        with sqlite3.connect(first) as db, sqlite3.connect(second) as other:
            for trigger, in db.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall():
                db.execute("DROP TRIGGER " + taxonomy.quote(trigger))
            db.row_factory = other.row_factory = sqlite3.Row
            for table in ("projects", "project_versions", "assets"):
                for row in other.execute("SELECT * FROM " + taxonomy.quote(table)):
                    keys = list(row.keys())
                    db.execute("INSERT INTO " + taxonomy.quote(table) + " (" + ",".join(map(taxonomy.quote, keys))
                               + ") VALUES (" + ",".join("?" for _ in keys) + ")", tuple(row))
        review = self.current_review(first, "multiple")
        supplied = [second_provenance, first_provenance]
        candidate = self.directory / "multiple-candidate"
        taxonomy.build(first, review, MIGRATIONS, candidate, supplied)
        report = taxonomy.verify(first, review, MIGRATIONS, candidate, legacy_provenance=list(reversed(supplied)))
        self.assertTrue(report["ok"])
        self.assertEqual(report["legacySources"], 2)
        self.assertEqual({item["kind"] for item in report["acceptedImportedExceptions"]},
                         {"published_duplicate_entry_keys", "private_invalid_content_omitted"})
        _, conflicting, _ = self.imported_snapshot("conflicting-import", user_updated_at="t3")
        with self.assertRaisesRegex(ValueError, "conflicting legacy exception provenance"):
            taxonomy.build(first, review, MIGRATIONS, self.directory / "conflicting-output", [first_provenance, conflicting])
        self.assertFalse((self.directory / "conflicting-output").exists())


if __name__ == "__main__":
    unittest.main()

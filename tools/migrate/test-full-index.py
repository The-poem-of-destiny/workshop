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
            CREATE TABLE projects (id TEXT, author_id TEXT, name TEXT, description TEXT, status TEXT, is_published INTEGER, visibility INTEGER, download_url TEXT, created_at TEXT, updated_at TEXT, project_type TEXT);
            INSERT INTO projects VALUES ('p1', 'u1', 'Example', 'Description', 'approved', 1, 1, 'projects/p1/worldbook.json', 't1', 't2', '角色');
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
        tables["project_versions"] = [{"id": REVISION, "project_id": "p1", "created_by": "u1",
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
            assets.append({"project_id": "p1", "version_id": REVISION, "kind": kind,
                           "r2_key": target, "sha256": digest, "bytes": len(payload)})
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
            row["tagsAcknowledged"] = True
        index_rows = candidate["tables"].pop("version_entry_index")
        for version in candidate["tables"]["project_versions"]:
            ready = version.pop("entry_index_ready")
            version["entry_index"] = json.dumps({"schemaVersion": 1, "entries": [
                {"kind": row["kind"], "entryKey": row["entry_key"], "name": row["name"],
                 "contentHash": row["content_hash"], "contentLength": row["content_length"]}
                for row in index_rows if row["version_id"] == version["id"]]}) if ready else None
        preparation.write_text(json.dumps(candidate), encoding="utf-8")
        result = subprocess.run([sys.executable, str(LOADER), "source", str(preparation), str(source), str(manifest)],
                                capture_output=True, text=True, check=False)
        self.assertTrue(result.stdout, result.stderr)
        return result, json.loads(result.stdout)

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


if __name__ == "__main__":
    unittest.main()

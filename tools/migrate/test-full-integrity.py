#!/usr/bin/env python3
"""Migration validation regressions against the complete canonical schema."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

DIRECTORY = Path(__file__).resolve().parent
MIGRATIONS = DIRECTORY.parents[1] / "apps/worker/migrations"
spec = importlib.util.spec_from_file_location("full_validate", DIRECTORY / "full-validate.py")
VALIDATOR = importlib.util.module_from_spec(spec)
spec.loader.exec_module(VALIDATOR)


class IntegrityTest(unittest.TestCase):
    def setUp(self):
        self.data = {
            "format": "workshop-full-migration-preparation-v1", "diagnostics": [], "omissions": [],
            "tables": {
                "users": [{"id": "u", "username": "author"}],
                "projects": [{"id": "p", "author_id": "u", "visibility": "public",
                              "working_version_id": "v", "published_version_id": "v"}],
                "project_versions": [{"id": "v", "project_id": "p", "version_no": 1, "title": "Project",
                                      "created_by": "u", "entry_index": json.dumps({"schemaVersion": 1, "entries": []}),
                                      "manifest_hash": hashlib.sha256(b"").hexdigest()}],
            },
        }

    def kinds(self, data):
        return {failure["kind"] for failure in VALIDATOR.validate(data, MIGRATIONS)["failures"]}

    def test_publication_and_readiness(self):
        self.assertEqual(self.kinds(self.data), set())
        data = copy.deepcopy(self.data)
        data["tables"]["projects"][0]["published_version_id"] = None
        self.assertIn("public_project_without_publication", self.kinds(data))
        data = copy.deepcopy(self.data)
        data["tables"]["project_versions"][0]["entry_index"] = None
        self.assertIn("published_revision_not_ready", self.kinds(data))
        data = copy.deepcopy(self.data)
        data["tables"]["project_versions"][0]["manifest_hash"] = "wrong"
        self.assertIn("invalid_published_revision_readiness", self.kinds(data))

    def test_gallery_is_independent_of_version_manifest(self):
        data = copy.deepcopy(self.data)
        digest = "a" * 64
        data["tables"]["assets"] = [{"id": "g", "project_id": "p", "version_id": None,
                                     "kind": "gallery_1", "r2_key": f"gallery/p/gallery_1-{digest}.png",
                                     "sha256": digest, "bytes": 1, "mime": "image/png"}]
        self.assertEqual(self.kinds(data), set())
        data["tables"]["assets"][0]["r2_key"] = f"gallery/other/gallery_1-{digest}.png"
        self.assertIn("invalid_gallery_project_association", self.kinds(data))

    def test_duplicate_index_exception_requires_matching_source_asset(self):
        data = copy.deepcopy(self.data)
        version_id = "legacy-revision-" + hashlib.sha256(b'["old"]').hexdigest()
        data["tables"]["projects"][0].update(working_version_id=version_id, published_version_id=version_id)
        data["tables"]["project_versions"][0].update(id=version_id, entry_index=None, manifest_hash=None)
        digest = "a" * 64
        data["tables"]["assets"] = [{"id": "a", "project_id": "p", "version_id": version_id,
                                     "kind": "worldbook", "r2_key": "content/a", "sha256": digest,
                                     "bytes": 1, "mime": "application/json"}]
        data["omissions"] = [{"table": "projects", "reason": "content index unavailable: duplicate entry keys",
                              "source": {"id": "old", "kind": "worldbook", "sha256": digest}}]
        report = VALIDATOR.validate(data, MIGRATIONS)
        self.assertEqual(report["failures"], [])
        self.assertTrue(report["accepted_exceptions"][0]["source_verification_required"])
        data["omissions"][0]["source"]["sha256"] = "wrong"
        self.assertIn("published_revision_not_ready", self.kinds(data))

    def test_private_invalid_content_requires_source_evidence_and_stays_private(self):
        data = copy.deepcopy(self.data)
        version_id = "legacy-revision-" + hashlib.sha256(b'["old"]').hexdigest()
        project = data["tables"]["projects"][0]
        project.update(visibility="private", working_version_id=version_id, published_version_id=version_id)
        data["tables"]["project_versions"][0].update(id=version_id, entry_index=None, manifest_hash=None)
        self.assertIn("published_revision_not_ready", self.kinds(data))
        data["omissions"] = [{"table": "projects", "reason": "invalid content asset omitted: invalid JSON",
                              "source": {"id": "old", "kind": "worldbook", "sha256": "a" * 64}}]
        report = VALIDATOR.validate(data, MIGRATIONS)
        self.assertEqual(report["failures"], [])
        self.assertEqual(report["accepted_exceptions"], [{"kind": "private_invalid_content_omitted", "count": 1,
                                                        "source_verification_required": True}])
        project["visibility"] = "public"
        self.assertIn("published_revision_not_ready", self.kinds(data))

    def test_index_entry_requires_matching_content_asset(self):
        data = copy.deepcopy(self.data)
        version = data["tables"]["project_versions"][0]
        version["entry_index"] = json.dumps({"schemaVersion": 1, "entries": [{"kind": "worldbook"}]})
        version["worldbook_count"] = 1
        self.assertIn("invalid_revision_entry_asset", self.kinds(data))


if __name__ == "__main__":
    unittest.main()

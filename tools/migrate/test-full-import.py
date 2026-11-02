#!/usr/bin/env python3
"""Import interruption and snapshot fidelity regressions, with no credentials or network."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


imp = module("full_import_regression", "full-d1-import.py")
stage = module("full_snapshot_regression", "full-staging-load.py")


class Response:
    code = 200

    def __init__(self, payload, headers=None, raw=False):
        self.body = payload if raw else json.dumps({"success": True, "result": payload}).encode()
        self.headers = headers or {}

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


class Server:
    def __init__(self, mode):
        self.mode = mode
        self.ingests = 0
        self.polls = 0

    def open(self, request, timeout=None):
        if request.method == "GET":
            return Response({"uuid": imp.STAGING_DATABASE, "name": "workshop-staging"})
        if request.method == "PUT":
            data = request.data.read()
            etag = hashlib.md5(data, usedforsecurity=False).hexdigest()
            return Response(b"", {"ETag": '"' + etag + '"'}, raw=True)
        action = json.loads(request.data)["action"]
        if action == "init":
            if self.mode == "cached":
                return Response({"status": "complete", "at_bookmark": "actual-bookmark"})
            return Response({"upload_url": "https://upload.invalid/signed?secret=private", "filename": "source.sql"})
        if action == "ingest":
            self.ingests += 1
            if self.mode == "ambiguous":
                raise URLError("synthetic-secret-token https://sensitive.invalid/private")
            return Response({"status": "active", "at_bookmark": "actual-bookmark"})
        self.polls += 1
        if self.mode == "poll-interrupted" and self.polls == 1:
            raise URLError("interrupted polling")
        return Response({"status": "complete", "at_bookmark": "actual-bookmark",
                         "result": {"num_queries": 1, "meta": {"rows_written": 1}}})


class ImportSafetyTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.sql = self.directory / "input.sql"
        self.sql.write_text("CREATE TABLE example (id TEXT);", encoding="utf-8")
        self.env = patch.dict("os.environ", {"STAGING_IMPORT_TOKEN": "synthetic-secret-token",
                                           "CLOUDFLARE_ACCOUNT_ID": "a" * 32})
        self.env.start()
        self.addCleanup(self.env.stop)

    def start(self, server):
        return imp.execute(imp.STAGING_DATABASE, self.sql, self.directory / "receipts")

    def test_poll_interruption_resumes_without_reingest(self):
        server = Server("poll-interrupted")
        with patch.object(imp, "build_opener", return_value=server):
            with self.assertRaises(imp.ImportFailure):
                self.start(server)
            result = imp.saved_status(self.directory / "receipts", resume=True)
        self.assertTrue(result["ok"])
        self.assertEqual(server.ingests, 1)
        receipt = json.loads((self.directory / "receipts" / result["final_receipt"]).read_text())
        self.assertEqual(receipt["details"]["response"]["result"]["at_bookmark"], "actual-bookmark")

    def test_unknown_ingest_is_not_resubmitted_or_polled_without_bookmark(self):
        server = Server("ambiguous")
        with patch.object(imp, "build_opener", return_value=server):
            with self.assertRaises(imp.ImportFailure):
                self.start(server)
            with self.assertRaisesRegex(imp.ImportFailure, "no saved actual at_bookmark"):
                imp.saved_status(self.directory / "receipts", resume=True)
        self.assertEqual((server.ingests, server.polls), (1, 0))
        for path in (self.directory / "receipts").glob("*.json"):
            receipt = path.read_text()
            self.assertNotIn("synthetic-secret-token", receipt)
            self.assertNotIn("https://", receipt)

    def test_cached_init_does_not_submit_second_ingest(self):
        server = Server("cached")
        with patch.object(imp, "build_opener", return_value=server):
            result = self.start(server)
        self.assertTrue(result["ok"])
        self.assertEqual((server.ingests, server.polls), (0, 0))

    def test_non_staging_target_rejected_before_ingest(self):
        server = Server("normal")
        with patch.object(imp, "build_opener", return_value=server):
            with self.assertRaises(imp.ImportFailure):
                imp.execute("10000000-0000-4000-8000-000000000000", self.sql, self.directory / "receipts")
        self.assertEqual(server.ingests, 0)


class SnapshotFidelityTest(unittest.TestCase):
    def test_large_payloads_and_sqlite_types_survive_multiple_pages(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            migrations = root / "migrations"
            migrations.mkdir()
            sql = ("CREATE TABLE example (n INTEGER, text_value TEXT, blob_value BLOB, real_value REAL);"
                   "CREATE VIRTUAL TABLE project_search USING fts5(content);"
                   "CREATE VIRTUAL TABLE project_search_short USING fts5(content);")
            (migrations / "0001_initial.sql").write_text(sql)
            source = sqlite3.connect(":memory:")
            self.addCleanup(source.close)
            source.executescript(sql)
            values = [(2**63 - 1 - i, "prefix\x00" + "x" * 3000, b"\x00\xff", 1.0 / 3)
                      for i in range(620)]
            source.executemany("INSERT INTO example VALUES (?, ?, ?, ?)", values)
            source.row_factory = sqlite3.Row
            def query(config, statement):
                return [dict(row) for row in source.execute(statement)]
            expected = stage.schema(source)
            with patch.object(stage, "query", side_effect=query):
                snapshot = stage.snapshot(root / "unused.json", migrations, root / "snapshot.sqlite", expected)
            try:
                self.assertEqual(snapshot.execute("SELECT * FROM example ORDER BY rowid").fetchall(), values)
            finally:
                snapshot.close()


if __name__ == "__main__":
    unittest.main()

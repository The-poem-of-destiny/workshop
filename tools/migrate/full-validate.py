#!/usr/bin/env python3
"""Validate preparation rows against a numbered SQLite migration chain.

Usage: python3 tools/migrate/full-validate.py PREPARATION.json --migrations DIR

The report contains table names from the schema, row positions (zero-based),
error classes and counts, never candidate values. Nothing is written to the
source, target, migration directory or shared files. Exit 0 means the SQL
checks passed and there are no preparation diagnostics; it does not authorize
or validate an R2 transfer or a production load.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
from pathlib import Path


def quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def error_code(exc):
    return getattr(exc, "sqlite_errorname", type(exc).__name__)


def migration_files(directory):
    files = sorted(directory.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    numbers = [int(path.name[:4]) for path in files]
    if not files or numbers != list(range(1, len(files) + 1)):
        raise ValueError("migration chain must start at 0001 and be contiguous, with one file per number")
    return files


def order_tables(db, names):
    # Delay trigger-generated metrics until after likes, then clear only the
    # generated rows before loading the authoritative legacy metric candidates.
    dependencies = {}
    for name in names:
        dependencies[name] = {row[2] for row in db.execute("PRAGMA foreign_key_list(" + quote(name) + ")")
                              if row[2] in names and row[2] != name}
    # Project pointers are restored after their versions and assets are inserted.
    if "projects" in dependencies:
        dependencies["projects"].difference_update({"project_versions", "assets"})
    for name in ("project_metrics_daily", "project_like_events"):
        if name in dependencies and "project_likes" in names:
            dependencies[name].add("project_likes")
    ordered = []
    remaining = set(names)
    while remaining:
        ready = sorted(name for name in remaining if not (dependencies[name] & remaining))
        if not ready:
            # Actual FK cycles are checked with deferred constraints below.
            ready = [min(remaining)]
        ordered.extend(ready)
        remaining.difference_update(ready)
    return ordered


# The stored row/value limit is independent of the 64 KB SQL statement limit.
# Account for UTF-8 payload and worst-case SQLite record headers, and also the
# actual JSON representation so escaping/serialization cannot hide large input.
MAX_STORED_ROW_BYTES = 2_000_000


def stored_row_size(row):
    values = list(dict(row).values())
    payload = sum(len(value.encode("utf-8")) if isinstance(value, str)
                  else len(value) if isinstance(value, bytes)
                  else 0 if value is None else 8 for value in values)
    record_bound = payload + 9 * (len(values) + 1)
    serialized = json.dumps(dict(row), ensure_ascii=False, separators=(",", ":"),
                            default=lambda value: value.hex() if isinstance(value, bytes) else str(value))
    return max(record_bound, len(serialized.encode("utf-8")))


def stored_size_failures(db):
    failures = []
    # Include stored defaults and generated values, not only input fields.
    names = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")]
    for name in names:
        cursor = db.execute("SELECT * FROM " + quote(name))
        keys = [column[0] for column in cursor.description]
        count = sum(stored_row_size(dict(zip(keys, row))) > MAX_STORED_ROW_BYTES for row in cursor)
        if count:
            failures.append({"kind": "stored_row_too_large", "table": name, "count": count,
                             "limit_bytes": MAX_STORED_ROW_BYTES})
    return failures

def application_integrity(db, preparation):
    failures, accepted = [], []
    schema = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}

    def check(kind, sql, **details):
        count = db.execute(sql).fetchone()[0]
        if count:
            failures.append({"kind": kind, "count": count, **details})

    if {"projects", "project_versions"} <= schema:
        for column in ("working_version_id", "published_version_id"):
            check("invalid_project_revision_pointer", "SELECT count(*) FROM projects p WHERE p." + quote(column) +
                  " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_versions v WHERE v.id = p." +
                  quote(column) + " AND v.project_id = p.id)", column=column)
        check("public_project_without_publication", "SELECT count(*) FROM projects WHERE visibility = 'public' AND published_version_id IS NULL")
    if {"projects", "assets"} <= schema:
        check("invalid_project_cover_pointer", "SELECT count(*) FROM projects p WHERE p.published_cover_asset_id IS NOT NULL "
              "AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = p.published_cover_asset_id "
              "AND a.project_id = p.id AND a.version_id IS NULL AND a.kind = 'cover')")
        extensions = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
        invalid = sum(key != f"gallery/{project}/{kind}-{digest}.{extensions.get(mime, '')}"
                      for project, kind, key, digest, mime in db.execute(
                          "SELECT project_id, kind, r2_key, sha256, mime FROM assets WHERE kind IN ('gallery_1', 'gallery_2')"))
        if invalid:
            failures.append({"kind": "invalid_gallery_project_association", "count": invalid})
    if {"projects", "project_versions", "assets"} <= schema:
        allowed = set()
        private_omissions = set()
        omissions = preparation.get("omissions", [])
        for item in omissions if isinstance(omissions, list) else []:
            if (not isinstance(item, dict) or item.get("table") != "projects"
                    or not isinstance(item.get("source"), dict)):
                continue
            reason = item.get("reason", "")
            if (reason != "content index unavailable: duplicate entry keys"
                    and not reason.startswith("invalid content asset omitted: ")):
                continue
            source = item["source"]
            if source.get("id") is None or source.get("kind") not in ("worldbook", "regex"):
                continue
            encoded = json.dumps([str(source["id"])], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            version = "legacy-revision-" + hashlib.sha256(encoded.encode("utf-8")).hexdigest()
            if reason.startswith("invalid content asset omitted: "):
                if db.execute("SELECT 1 FROM projects p JOIN project_versions v ON v.project_id = p.id "
                              "WHERE v.id = ? AND p.visibility = 'private'", (version,)).fetchone():
                    private_omissions.add(version)
                continue
            if db.execute("SELECT 1 FROM assets WHERE version_id = ? AND kind = ? AND sha256 = ?",
                          (version, source["kind"], source.get("sha256"))).fetchone():
                allowed.add(version)
        for version, index, manifest, worldbook, regex in db.execute(
                "SELECT v.id, v.entry_index, v.manifest_hash, v.worldbook_count, v.regex_count "
                "FROM project_versions v WHERE EXISTS (SELECT 1 FROM projects p WHERE p.published_version_id = v.id)"):
            if index is None:
                if version in allowed and manifest is None and worldbook == 0 and regex == 0:
                    accepted.append({"kind": "published_duplicate_entry_keys", "count": 1,
                                     "source_verification_required": True})
                elif version in private_omissions and manifest is None and worldbook == 0 and regex == 0:
                    accepted.append({"kind": "private_invalid_content_omitted", "count": 1,
                                     "source_verification_required": True})
                else:
                    failures.append({"kind": "published_revision_not_ready", "count": 1})
                continue
            try:
                document = json.loads(index)
                entries = document["entries"]
                if not isinstance(document, dict) or set(document) != {"schemaVersion", "entries"} or document["schemaVersion"] != 1 or not isinstance(entries, list):
                    raise ValueError("invalid index")
                kinds = [entry["kind"] for entry in entries]
                if any(kind not in ("worldbook", "regex") for kind in kinds):
                    raise ValueError("invalid entry kind")
            except (ValueError, TypeError, KeyError):
                failures.append({"kind": "invalid_published_revision_readiness", "count": 1})
                continue
            assets = list(db.execute("SELECT kind, sha256 FROM assets WHERE version_id = ? ORDER BY kind, r2_key", (version,)))
            asset_kinds = {kind for kind, _ in assets}
            if any(kind not in asset_kinds for kind in kinds):
                failures.append({"kind": "invalid_revision_entry_asset", "count": 1})
            hashes = "\n".join(kind + ":" + digest for kind, digest in assets)
            if (worldbook != kinds.count("worldbook") or regex != kinds.count("regex")
                    or manifest != hashlib.sha256(hashes.encode("utf-8")).hexdigest()):
                failures.append({"kind": "invalid_published_revision_readiness", "count": 1})
    return {"failures": failures, "accepted_exceptions": accepted}


def validate(preparation, directory):
    report = {"format": "workshop-full-migration-validation-v1", "ok": False,
              "migration_count": 0, "diagnostics_count": 0, "tables": {}, "failures": []}
    failures = report["failures"]

    def fail(kind, **details):
        failures.append({"kind": kind, **details})

    if not isinstance(preparation, dict) or preparation.get("format") != "workshop-full-migration-preparation-v1":
        fail("invalid_preparation_format")
        return report
    tables = preparation.get("tables")
    diagnostics = preparation.get("diagnostics")
    if not isinstance(tables, dict) or not isinstance(diagnostics, list):
        fail("invalid_preparation_structure")
        return report
    report["diagnostics_count"] = len(diagnostics)
    if diagnostics:
        fail("preparation_diagnostics", count=len(diagnostics))
    try:
        migrations = migration_files(directory)
    except (OSError, ValueError):
        fail("invalid_migration_chain")
        return report

    db = sqlite3.connect(":memory:")
    try:
        for index, path in enumerate(migrations, 1):
            try:
                db.executescript(path.read_text(encoding="utf-8"))
                report["migration_count"] += 1
            except (sqlite3.Error, OSError, UnicodeError) as exc:
                fail("migration_failed", migration=index, error=error_code(exc))
                return report
        db.execute("PRAGMA foreign_keys = ON")
        if db.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            fail("foreign_keys_unavailable")
            return report
        schema = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
        valid = {}
        for index, (name, rows) in enumerate(tables.items()):
            if not isinstance(name, str) or name not in schema:
                fail("unknown_table", table_position=index)
                continue
            if not isinstance(rows, list):
                fail("invalid_table_rows", table=name)
                continue
            columns = {row[1] for row in db.execute("PRAGMA table_xinfo(" + quote(name) + ")") if row[6] == 0}
            valid[name] = (rows, columns)
            report["tables"][name] = {"candidates": len(rows), "inserted": 0}

        db.execute("BEGIN")
        db.execute("PRAGMA defer_foreign_keys = ON")
        inserted_projects = set()
        for name in order_tables(db, set(valid)):
            rows, columns = valid[name]
            if name in ("project_metrics_daily", "project_like_events") and "project_likes" in valid:
                db.execute("DELETE FROM " + quote(name))
            for index, row in enumerate(rows):
                if not isinstance(row, dict):
                    fail("invalid_row", table=name, row=index)
                    continue
                if any(not isinstance(key, str) or key not in columns for key in row):
                    fail("unknown_columns", table=name, row=index)
                    continue
                if stored_row_size(row) > MAX_STORED_ROW_BYTES:
                    fail("stored_row_too_large", table=name, row=index, limit_bytes=MAX_STORED_ROW_BYTES)
                    continue
                keys = list(row)
                sql = ("INSERT INTO " + quote(name) + " (" + ", ".join(map(quote, keys)) + ") VALUES (" +
                       ", ".join("?" for _ in keys) + ")") if keys else "INSERT INTO " + quote(name) + " DEFAULT VALUES"
                try:
                    db.execute("SAVEPOINT candidate")
                    db.execute(sql, tuple(row[key] for key in keys))
                    db.execute("RELEASE candidate")
                    report["tables"][name]["inserted"] += 1
                    if name == "projects":
                        inserted_projects.add(index)
                except (sqlite3.Error, TypeError, OverflowError, ValueError) as exc:
                    db.execute("ROLLBACK TO candidate")
                    db.execute("RELEASE candidate")
                    fail("insert_failed", table=name, row=index, error=error_code(exc))

        # Relationship triggers change imported aggregate counters. Restore the
        # candidate values so later checks see the intended target snapshot.
        if "projects" in valid:
            for index, row in enumerate(valid["projects"][0]):
                if index not in inserted_projects:
                    continue
                fields = [key for key in ("likes_count", "subscriptions_count", "downloads_count") if key in row]
                if not fields:
                    continue
                try:
                    db.execute("UPDATE projects SET " + ", ".join(quote(key) + " = ?" for key in fields) +
                               " WHERE id = ?", tuple(row[key] for key in fields) + (row["id"],))
                except (sqlite3.Error, TypeError, OverflowError, ValueError) as exc:
                    fail("counter_restore_failed", table="projects", row=index, error=error_code(exc))

        for table, _rowid, _parent, _fkid in db.execute("PRAGMA foreign_key_check"):
            fail("foreign_key_violation", table=table if table in schema else "unknown")
        integrity = application_integrity(db, preparation)
        failures.extend(integrity["failures"])
        report["accepted_exceptions"] = integrity["accepted_exceptions"]
        failures.extend(stored_size_failures(db))
        db.rollback()
    except sqlite3.Error as exc:
        fail("validation_failed", error=error_code(exc))
    finally:
        db.close()
    report["ok"] = not failures
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preparation", type=Path)
    parser.add_argument("--migrations", type=Path, required=True, help="directory containing the complete numbered target migration chain")
    args = parser.parse_args()
    try:
        preparation = json.loads(args.preparation.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        print(json.dumps({"format": "workshop-full-migration-validation-v1", "ok": False,
                          "failures": [{"kind": "preparation_read_failed"}]}))
        return 1
    report = validate(preparation, args.migrations)
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

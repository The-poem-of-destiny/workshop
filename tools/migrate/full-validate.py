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
        # These project pointers are intentionally not declared as SQL FKs.
        if {"projects", "project_revisions"} <= schema:
            for column in ("working_revision_id", "published_revision_id"):
                project_columns = {row[1] for row in db.execute("PRAGMA table_info(projects)")}
                if column in project_columns:
                    count = db.execute("SELECT count(*) FROM projects p WHERE p." + quote(column) +
                        " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_revisions r WHERE r.id = p." +
                        quote(column) + " AND r.project_id = p.id)").fetchone()[0]
                    if count:
                        fail("invalid_project_revision_pointer", column=column, count=count)
        if {"projects", "assets"} <= schema:
            project_columns = {row[1] for row in db.execute("PRAGMA table_info(projects)")}
            if "published_cover_asset_id" in project_columns:
                count = db.execute(
                    "SELECT count(*) FROM projects p WHERE p.published_cover_asset_id IS NOT NULL "
                    "AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.id = p.published_cover_asset_id "
                    "AND a.project_id = p.id AND a.revision_id IS NULL AND a.kind = 'cover')"
                ).fetchone()[0]
                if count:
                    fail("invalid_project_cover_pointer", count=count)
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

#!/usr/bin/env python3
"""Rehearse a complete staging replacement in the dedicated isolated D1 database."""
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
import sqlite3
import sys

import importlib.util


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


stage = module("full_stage_rehearsal", "full-staging-load.py")


def logical_rows(db):
    names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
             if not r[0].startswith(("sqlite_", "_cf_")) and r[0] not in stage.FTS_SHADOWS}
    return {name: Counter(tuple(row) for row in db.execute("SELECT * FROM " + stage.quote(name)))
            for name in names}


def run(args):
    importer = module("full_d1_rehearsal", "full-d1-import.py")
    if args.database_id == stage.DATABASE:
        raise ValueError("rehearsal must not target staging itself")
    directory = args.artifacts.resolve()
    if directory == stage.ROOT or stage.ROOT in directory.parents:
        raise ValueError("private artifacts must remain outside the repository")
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    (directory / ".wrangler-home").mkdir(mode=0o700)
    config = directory / "wrangler.json"
    stage.private_write(config, json.dumps({"d1_databases": [{
        "binding": "DB", "database_name": "workshop-staging-import-rehearsal",
        "database_id": args.database_id}]}))
    existing = stage.query(config, "SELECT name FROM sqlite_master WHERE type='table' "
                           "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
    if existing:
        raise ValueError("dedicated rehearsal database is not empty")
    preparation = stage.loader.preparation(args.preparation)
    source = stage.loader.source_reconcile(preparation, args.source, args.manifest)
    if not source["ok"]:
        raise ValueError("source reconciliation failed")
    data = dict(preparation, tables={k: v for k, v in preparation["tables"].items()
                                    if k not in stage.PRESERVED})
    validation = stage.validator.validate(data, args.migrations)
    if not validation["ok"]:
        raise ValueError("preparation validation failed")
    expected = stage.expected_schema(args.migrations)
    before = sqlite3.connect(args.before)
    blank = sqlite3.connect(":memory:")
    local = sqlite3.connect(directory / "local-rehearsal.sqlite")
    try:
        if stage.schema(before) != expected:
            raise ValueError("baseline schema mismatch")
        migrations = stage.validator.migration_files(args.migrations)
        schema_sql = "\n".join(path.read_text(encoding="utf-8") for path in migrations)
        blank.executescript(schema_sql)
        all_rows = logical_rows(before)
        writable = set(all_rows) - stage.PRESERVED - stage.DERIVED - {"d1_migrations"}
        before.row_factory = sqlite3.Row
        seed = {name: [dict(row) for row in before.execute("SELECT * FROM " + stage.quote(name))]
                for name in writable}
        seed_sql = stage.build_sql(blank, seed)
        protected_sql = []
        for name in sorted(stage.PRESERVED & all_rows.keys()):
            protected_sql.append("DELETE FROM " + stage.quote(name) + ";")
            for row in before.execute("SELECT * FROM " + stage.quote(name)):
                keys = row.keys()
                protected_sql.append("INSERT INTO " + stage.quote(name) + " (" +
                                     ", ".join(map(stage.quote, keys)) + ") VALUES (" +
                                     ", ".join(stage.value(row[key]) for key in keys) + ");")
        setup_sql = schema_sql + "\n" + seed_sql + "\n" + "\n".join(protected_sql) + "\n"
        setup_path = directory / "setup.sql"
        stage.private_write(setup_path, setup_sql)
        before.backup(local)
        preserved = stage.preserved_rows(local)
        replacement = stage.build_sql(local, data["tables"])
        load_path = directory / "load.sql"
        stage.private_write(load_path, replacement)
        local.execute("PRAGMA foreign_keys=ON")
        local.executescript("BEGIN;\n" + replacement + "COMMIT;")
        if (stage.schema(local) != expected or stage.preserved_rows(local) != preserved
                or list(local.execute("PRAGMA foreign_key_check"))):
            raise ValueError("local replacement invariants failed")
        local.close()
        if not stage.loader.reconcile(data, directory / "local-rehearsal.sqlite")["ok"]:
            raise ValueError("local replacement content mismatch")
        if not importer.execute(args.database_id, setup_path, directory / "setup-import")["ok"]:
            raise RuntimeError("remote baseline import failed; inspect private receipts")
        remote = stage.snapshot(config, args.migrations, directory / "remote-before.sqlite", expected)
        try:
            if logical_rows(remote) != all_rows:
                raise ValueError("remote baseline does not match the staging backup")
        finally:
            remote.close()
        if not importer.execute(args.database_id, load_path, directory / "replacement-import")["ok"]:
            raise RuntimeError("remote replacement import failed; inspect private receipts")
        remote = stage.snapshot(config, args.migrations, directory / "remote-after.sqlite", expected)
        try:
            if stage.schema(remote) != expected or stage.preserved_rows(remote) != preserved:
                raise ValueError("remote replacement changed schema or protected configuration")
        finally:
            remote.close()
        reconciliation = stage.loader.reconcile(data, directory / "remote-after.sqlite")
        result = {"ok": reconciliation["ok"], "database_id": args.database_id,
                  "baseline_matches_staging_backup": True, "schema_and_configuration_preserved": True,
                  "source_reconciliation": source, "reconciliation": reconciliation}
        stage.private_write(directory / "rehearsal.json", json.dumps(result, indent=2) + "\n")
        if not result["ok"]:
            raise ValueError("remote replacement reconciliation failed")
        return {"ok": True, "database_id": args.database_id, "artifacts": str(directory),
                "tables": {name: len(rows) for name, rows in data["tables"].items()}}
    finally:
        before.close()
        blank.close()
        local.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("preparation", "before", "source", "manifest", "migrations", "artifacts"):
        parser.add_argument("--" + option, type=Path, required=True)
    parser.add_argument("--database-id", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(run(args), ensure_ascii=True))
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

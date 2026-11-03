#!/usr/bin/env python3
"""Build and seal an offline, bounded, multi-day staging candidate plan.

No credentials, network access, remote database or deployment operations are used.
The output is private. CLI errors deliberately omit SQL and business row values.
"""
from __future__ import annotations

import argparse
from collections import Counter
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3
import sys

FORMAT = "workshop-multiday-plan-v1"
STATEMENT_BYTES = 64_000
BATCH_BYTES = 1_000_000
BATCH_ROWS = 250
BATCH_ESTIMATED_WRITES = 20_000
MAX_GROUP_ESTIMATED_WRITES = 25_000
MAX_ROW_BYTES = 2_000_000
# Wrangler's installed getCreateMigrationsTableQuery/buildMigrationQuery use
# this ledger and CURRENT_TIMESTAMP. It is platform metadata, not app schema.
LEDGER_CREATE_SQL = """CREATE TABLE IF NOT EXISTS "d1_migrations"(
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);"""


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


loader = module("multiday_source_loader", "full-load.py")
validator = module("multiday_validator", "full-validate.py")
stage = module("multiday_sql_helper", "d1-data.py")
quote = validator.quote


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(stable(value).encode("utf-8")).hexdigest()


def file_hash(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def pin(path):
    path = Path(path).resolve(strict=True)
    if not path.is_file():
        raise ValueError("input is not a regular file")
    return {"path": str(path), "sha256": file_hash(path)}


def private_write(path, content):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    fd = os.open(path, flags, 0o600)
    with os.fdopen(fd, "wb") as out:
        out.write(content if isinstance(content, bytes) else content.encode("utf-8"))
        out.flush()
        os.fsync(out.fileno())


def json_write(path, value):
    private_write(path, stable(value) + "\n")


def statements(sql):
    """Split only at SQLite-complete statements, including entire trigger bodies."""
    result, pending = [], ""
    for char in sql:
        pending += char
        if char == ";" and sqlite3.complete_statement(pending):
            result.append(pending.strip())
            pending = ""
    # A trailing comment is legal; an unterminated statement is not.
    tail = re.sub(r"/\*.*?\*/|--[^\n]*", "", pending, flags=re.S).strip()
    if tail:
        raise ValueError("incomplete SQL statement")
    return result


def schema(db):
    return [{"type": kind, "name": name, "table": table, "sql": sql}
            for kind, name, table, sql in db.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_schema "
                "WHERE name NOT LIKE 'sqlite_%' AND tbl_name != 'd1_migrations' ORDER BY type,name")]


def inventory(db):
    result = {"schema": schema(db), "tables": {}}
    for name, in db.execute("SELECT name FROM sqlite_schema WHERE type='table' "
                            "AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name"):
        indexes = []
        for index in db.execute("PRAGMA index_list(" + quote(name) + ")"):
            indexes.append({"definition": list(index), "columns": [list(row) for row in
                db.execute("PRAGMA index_xinfo(" + quote(index[1]) + ")")]})
        result["tables"][name] = {
            "columns": [list(row) for row in db.execute("PRAGMA table_xinfo(" + quote(name) + ")")],
            "foreign_keys": [list(row) for row in db.execute("PRAGMA foreign_key_list(" + quote(name) + ")")],
            "indexes": sorted(indexes, key=lambda row: row["definition"][1]),
        }
    return result


def ledger_schema(db):
    return [list(row) for row in db.execute(
        "SELECT type,name,sql FROM sqlite_schema WHERE tbl_name='d1_migrations' ORDER BY type,name")]


def validate_ledger(db, migrations):
    expected = [(index, migration["name"]) for index, migration in enumerate(migrations, 1)]
    actual = db.execute("SELECT id,name FROM d1_migrations ORDER BY id").fetchall()
    if actual != expected:
        raise ValueError("Wrangler migration ledger ordered names or IDs differ")
    canonical = sqlite3.connect(":memory:")
    try:
        canonical.execute(LEDGER_CREATE_SQL)
        if ledger_schema(db) != ledger_schema(canonical):
            raise ValueError("Wrangler migration ledger schema differs")
    finally:
        canonical.close()
    for timestamp, in db.execute("SELECT applied_at FROM d1_migrations"):
        if (not isinstance(timestamp, str)
                or re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", timestamp) is None
                or db.execute("SELECT datetime(?,'+0 seconds')", (timestamp,)).fetchone()[0] != timestamp):
            raise ValueError("Wrangler migration ledger timestamp is not standard UTC")
    return {"table": "d1_migrations", "schema": ledger_schema(db), "names": [name for _, name in expected],
            "timestamp_policy": "SQLite CURRENT_TIMESTAMP UTC; applied_at excluded from deterministic logical evidence"}


def plan_digest(plan):
    return digest({key: value for key, value in plan.items() if key not in ("plan_id", "candidate_name")})


def inputs(preparation_path, source_path, manifest_path, migrations_dir):
    migrations = validator.migration_files(Path(migrations_dir))
    if len(migrations) != 40:
        raise ValueError("the complete final migration chain through 0040 is required")
    result = {"preparation": pin(preparation_path), "source": pin(source_path),
              "manifest": pin(manifest_path), "migrations_dir": str(Path(migrations_dir).resolve()),
              "migrations": [dict(pin(path), name=path.name) for path in migrations]}
    # Byte-pin the utilities used to interpret source, SQL and canonical integrity.
    helpers = ["multiday-plan.py", "multiday-staging.py", "multiday-budget.py",
               "full-load.py", "full-validate.py", "d1-data.py",
               "full-d1-import.py", "full-transform-content.mjs"]
    result["utilities"] = [pin(Path(__file__).with_name(name)) for name in helpers]
    result["utilities"].append(pin(Path(__file__).resolve().parents[2] / "pnpm-lock.yaml"))
    domain = Path(__file__).resolve().parents[2] / "packages/domain/src"
    result["utilities"].extend(pin(domain / name) for name in ("project-content.ts", "content-policy.ts"))
    # Pin original object bytes, including rejected/omitted source objects used by
    # independent reconciliation. The manifest alone does not freeze local bytes.
    root = Path(manifest_path).resolve().parent / "r2"
    result["source_objects"] = []
    if root.exists():
        for path in sorted(root.rglob("*")):
            if path.is_file():
                if not path.resolve().is_relative_to(root.resolve()):
                    raise ValueError("source object escapes backup directory")
                result["source_objects"].append(pin(path))
    return result


def canonical_search_statements(trigger_sql, project_id, columns):
    match = re.search(r"\bBEGIN\b(.*)\bEND\s*$", trigger_sql, re.S | re.I)
    if match is None:
        raise ValueError("unsupported canonical search insertion trigger")
    body = match.group(1)
    identity = stage.value(project_id)

    def replace(match):
        field = match.group(1)
        if field not in columns and field.lower() != "rowid":
            raise ValueError("unsupported canonical search field")
        return "(SELECT " + quote(field) + " FROM projects WHERE id = " + identity + ")"

    body = re.sub(r"\bNEW\.([A-Za-z_][A-Za-z_0-9]*)\b", replace, body, flags=re.I)
    if re.search(r"\b(?:NEW|OLD)\.", body, re.I):
        raise ValueError("unsupported canonical search trigger reference")
    return statements(body)


def rows_digest(db):
    """Logical rows, excluding FTS pages and environment-owned seed timestamps."""
    tables = {}
    for name, in db.execute("SELECT name FROM sqlite_schema WHERE type='table' "
                            "AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        if name in stage.FTS_SHADOWS:
            continue
        if name == "d1_migrations":
            tables[name] = [list(row) for row in db.execute(
                "SELECT id,name FROM d1_migrations ORDER BY id")]
            continue
        if name == "site_settings":
            tables[name] = [list(row) for row in db.execute(
                "SELECT key,value,updated_by FROM site_settings ORDER BY key")]
            continue
        rows = [list(row) for row in db.execute("SELECT * FROM " + quote(name))]
        tables[name] = sorted(rows, key=stable)
    return digest(tables)


def check_row_bounds(db):
    largest = 0
    for name, in db.execute("SELECT name FROM sqlite_schema WHERE type='table' "
                            "AND name NOT LIKE 'sqlite_%'"):
        cursor = db.execute("SELECT * FROM " + quote(name))
        columns = [column[0] for column in cursor.description]
        for row in cursor:
            size = validator.stored_row_size(dict(zip(columns, row)))
            largest = max(largest, size)
            if size > MAX_ROW_BYTES:
                raise ValueError("stored row exceeds D1 row size limit")
    return largest


def expected_search(db, data, trigger_sql):
    """Independently exercise canonical triggers, then compare by business ID."""
    oracle = sqlite3.connect(":memory:")
    try:
        db.backup(oracle)
        for name, in list(oracle.execute("SELECT name FROM sqlite_schema WHERE type='trigger'")):
            oracle.execute("DROP TRIGGER " + quote(name))
        for name in ("project_search", "project_search_short", "project_search_tags"):
            oracle.execute("DELETE FROM " + quote(name))
        # Invoke the actual canonical insertion trigger in an oracle whose project
        # rowids deliberately differ. Copying candidate-local rowids cannot pass.
        oracle.execute("ALTER TABLE projects RENAME TO oracle_saved_projects")
        table_sql = next(row[0] for row in db.execute(
            "SELECT sql FROM sqlite_schema WHERE type='table' AND name='projects'"))
        oracle.execute(table_sql)
        # RENAME rewrites the short-source view to the saved table; restore its
        # canonical definition so it resolves oracle projects instead.
        oracle.execute("DROP VIEW project_search_short_source")
        oracle.execute(db.execute("SELECT sql FROM sqlite_schema WHERE name='project_search_short_source'").fetchone()[0])
        oracle.execute(trigger_sql)
        columns = [row[1] for row in db.execute("PRAGMA table_xinfo(projects)") if row[6] == 0]
        for rowid, row in enumerate(reversed(list(db.execute("SELECT * FROM projects ORDER BY id"))), 1001):
            oracle.execute("INSERT INTO projects (rowid," + ",".join(map(quote, columns)) + ") VALUES (" +
                           ",".join("?" for _ in range(len(columns) + 1)) + ")", [rowid, *row])
            oracle.execute("UPDATE projects SET published_version_id=published_version_id WHERE rowid=?", (rowid,))
        for name in ("project_search", "project_search_short"):
            if db.execute("SELECT count(*) FROM " + name).fetchone()[0] != db.execute("SELECT count(*) FROM projects p JOIN project_versions v ON v.id=p.published_version_id").fetchone()[0]:
                raise ValueError("search index contains missing or orphan documents")
            sql = "SELECT p.id,s.* FROM " + name + " s JOIN projects p ON p.rowid=s.rowid"
            expected = Counter(oracle.execute(sql).fetchall())
            actual = Counter(db.execute(sql).fetchall())
            if expected != actual:
                raise ValueError("canonical search content or project mapping differs")
        if Counter(oracle.execute("SELECT * FROM project_search_tags")) != Counter(db.execute("SELECT * FROM project_search_tags")):
            raise ValueError("canonical search tags differ")
        for name in ("project_search", "project_search_short"):
            # FTS integrity checks catch token-index corruption invisible in SELECT.
            db.execute("INSERT INTO " + name + "(" + name + ") VALUES('integrity-check')")
    finally:
        oracle.close()


class Emitter:
    def __init__(self, root, db):
        self.root, self.db, self.batches = root, db, []
        self.db.execute("PRAGMA foreign_keys = ON")

    def emit(self, phase, sqls, data_rows=0, estimate=0, allow_large=False):
        sqls = [sql.rstrip().rstrip(";") + ";" for sql in sqls]
        if not sqls:
            return
        if any(len(sql.encode("utf-8")) > STATEMENT_BYTES for sql in sqls):
            raise ValueError("SQL statement exceeds 64000 bytes")
        text = "PRAGMA foreign_keys = ON;\n" + "\n".join(sqls) + "\n"
        size = len(text.encode("utf-8"))
        if data_rows > BATCH_ROWS or (size > BATCH_BYTES and not allow_large):
            raise ValueError("batch exceeds bounded data or SQL size limit")
        name = f"{len(self.batches) + 1:06d}"
        path = self.root / "batches" / (name + ".sql")
        private_write(path, text)
        # The oracle executes precisely the sealed SQL, including each batch's FK
        # setting, and commits every pause boundary without deferred cross-batch FKs.
        try:
            self.db.executescript("BEGIN;\n" + text + "COMMIT;")
        except BaseException:
            self.db.rollback()
            raise
        if self.db.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            raise ValueError("batch disabled foreign key enforcement")
        if self.db.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise ValueError("batch leaves foreign key violations at pause boundary")
        self.batches.append({"id": name, "phase": phase, "file": path.relative_to(self.root).as_posix(),
                             "sha256": file_hash(path), "statement_count": len(statements(text)),
                             "estimated_rows_written": max(1, estimate), "data_rows": data_rows,
                             "bytes": size, "single_large_row": bool(allow_large)})

    def groups(self, phase, groups):
        pending, count, estimate, size = [], 0, 0, 32
        for sqls, rows, writes in groups:
            weight = sum(len(sql.encode("utf-8")) + 1 for sql in sqls)
            if writes > MAX_GROUP_ESTIMATED_WRITES:
                raise ValueError("one indivisible SQL group exceeds conservative Free-day write allowance")
            if pending and (count + rows > BATCH_ROWS or size + weight > BATCH_BYTES
                            or estimate + writes > BATCH_ESTIMATED_WRITES):
                self.emit(phase, pending, count, estimate)
                pending, count, estimate, size = [], 0, 0, 32
            if weight + 32 > BATCH_BYTES:
                if rows != 1:
                    raise ValueError("oversized multi-row SQL group")
                self.emit(phase, sqls, rows, writes, allow_large=True)
                continue
            if writes > BATCH_ESTIMATED_WRITES:
                self.emit(phase, sqls, rows, writes)
                continue
            pending.extend(sqls)
            count += rows
            estimate += writes
            size += weight
        self.emit(phase, pending, count, estimate)


def build(preparation_path, source_path, manifest_path, migrations_dir, output_dir):
    preparation_path, source_path, manifest_path, migrations_dir, output_dir = map(
        Path, (preparation_path, source_path, manifest_path, migrations_dir, output_dir))
    frozen_inputs = inputs(preparation_path, source_path, manifest_path, migrations_dir)
    data = loader.preparation(preparation_path)
    source_check = loader.source_reconcile(data, source_path, manifest_path)
    if not source_check["ok"]:
        raise ValueError("original preparation does not reconcile to approved source")
    candidate_data = copy.deepcopy(data)
    candidate_data["tables"].pop("site_settings", None)
    validation = validator.validate(candidate_data, migrations_dir)
    if not validation["ok"]:
        raise ValueError("business preparation fails complete migration chain validation")
    tables = copy.deepcopy(data["tables"])
    tables.pop("site_settings", None)
    output_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
    (output_dir / "batches").mkdir(mode=0o700)
    json_write(output_dir / "source-check.json", source_check)
    private_write(output_dir / "preparation.json", preparation_path.read_bytes())
    db_path = output_dir / "expected.sqlite"
    fd = os.open(db_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(db_path)
    try:
        emitter = Emitter(output_dir, db)
        emitter.emit("initialize:wrangler-ledger", [LEDGER_CREATE_SQL], estimate=128)
        # Every migration is replayed in order while the candidate has no business
        # data. Separate batches never carry incomplete trigger bodies.
        for index, migration in enumerate(frozen_inputs["migrations"], 1):
            sqls = statements(Path(migration["path"]).read_text(encoding="utf-8"))
            groups = [([sql], 0, 128) for sql in sqls]
            groups.append((["INSERT INTO d1_migrations(id,name) VALUES (" + str(index) + "," +
                            stage.value(migration["name"]) + ");"], 1, 64))
            emitter.groups("initialize:" + migration["name"], groups)
        migration_ledger = validate_ledger(db, frozen_inputs["migrations"])
        canonical_schema = schema(db)
        canonical_inventory = inventory(db)
        triggers = [(row["name"], row["sql"]) for row in canonical_schema if row["type"] == "trigger"]
        search_trigger = dict(triggers).get("project_search_update")
        if not search_trigger or "project_versions" not in canonical_inventory["tables"]:
            raise ValueError("required final canonical schema is absent")
        emitter.groups("suspend-triggers", [(["DROP TRIGGER " + quote(name) + ";"], 0, 8)
                                            for name, _ in triggers])
        settings = list(db.execute("SELECT * FROM site_settings ORDER BY key"))
        all_tables = set(canonical_inventory["tables"])
        project_columns = {row[1] for row in db.execute("PRAGMA table_info(projects)")}
        for name in validator.order_tables(db, set(tables)):
            indexes = len(list(db.execute("PRAGMA index_list(" + quote(name) + ")")))

            def row_groups():
                for row in sorted(tables[name], key=stable):
                    if validator.stored_row_size(row) > MAX_ROW_BYTES:
                        raise ValueError("candidate row exceeds D1 row size limit")
                    lines = ["PRAGMA foreign_keys = ON;"]
                    chunk_table = "_workshop_multiday_text_chunks"
                    chunks = stage.insert_row(db, name, row, all_tables, lines, False, chunk_table)
                    if chunks:
                        lines.append("DROP TABLE " + quote(chunk_table) + ";")
                    chunk_count = sum(line.startswith("INSERT INTO " + quote(chunk_table)) for line in lines)
                    # Includes row+all ordinary/unique indexes, schema/chunk writes,
                    # chunk deletes and an allowance for SQLite B-tree maintenance.
                    yield lines[1:], 1, 16 * (1 + indexes) + chunk_count * 8 + (64 if chunks else 0)

            emitter.groups("data:" + name, row_groups())
        search_groups = []
        for row in sorted(tables.get("projects", []), key=lambda row: row["id"]):
            sqls = canonical_search_statements(search_trigger, row["id"], project_columns)
            version = next((version for version in tables.get("project_versions", []) if version["id"] == row.get("published_version_id")), {})
            tags = {tag for tag in json.loads(version.get("tags", "[]")) if isinstance(tag, str) and tag}
            if version.get("extension_type"):
                tags.add(version["extension_type"])
            # FTS writes internal token B-trees as well as document rows. This is
            # deliberately pessimistic, not a promise about Cloudflare billing.
            search_bytes = sum(len(str(version.get(key) or "").encode("utf-8")) for key in
                               ("title", "project_type", "extension_type", "tags"))
            author = db.execute("SELECT username,global_name FROM users WHERE id=?", (row["author_id"],)).fetchone()
            search_bytes += sum(len((part or "").encode("utf-8")) for part in author)
            search_groups.append((sqls, len(tags) + 2, 256 + 32 * len(tags) + 16 * search_bytes))
        emitter.groups("search", search_groups)
        emitter.groups("restore-triggers", [([sql], 0, 8) for _, sql in triggers])
        if schema(db) != canonical_schema or inventory(db) != canonical_inventory:
            raise ValueError("final schema differs from complete canonical migration chain")
        if validate_ledger(db, frozen_inputs["migrations"]) != migration_ledger:
            raise ValueError("Wrangler migration ledger changed during business import")
        if list(db.execute("SELECT * FROM site_settings ORDER BY key")) != settings:
            raise ValueError("canonical seed settings were modified by data import")
        db.commit()
        comparison = copy.deepcopy(data)
        comparison["tables"].pop("site_settings", None)
        reconciliation = loader.reconcile(comparison, db_path)
        if not reconciliation["ok"]:
            raise ValueError("emitted SQL does not independently reconcile business data")
        expected_search(db, data, search_trigger)
        largest_row = check_row_bounds(db)
        db.commit()
        canonical_inventory.update({"format": "workshop-multiday-inventory-v1", "schema_sha256": digest(canonical_schema),
            "sqlite_validation": validation, "reconciliation": reconciliation, "largest_stored_row_bytes": largest_row,
            "migration_ledger": migration_ledger,
            "logical_snapshot_sha256": rows_digest(db),
            "site_settings_policy": "canonical migration seed/default only; operational staging settings are a separate cutover gate",
            "estimate_policy": "Conservative row/index/FTS/chunk allowance; not an account billing guarantee."})
        json_write(output_dir / "inventory.json", canonical_inventory)
    finally:
        db.close()
    # Exact rehearsal SQLite pages contain canonical CURRENT_TIMESTAMP seed data.
    # Keep their byte seal outside the deterministic execution manifest; expected
    # SQLite is private non-executable evidence, never an authorization input.
    json_write(output_dir / "expected.sqlite.sha256", {"file": "expected.sqlite", "sha256": file_hash(db_path)})
    artifacts = {name: {"file": name, "sha256": file_hash(output_dir / name)} for name in
                 ("preparation.json", "source-check.json", "inventory.json")}
    plan = {"format": FORMAT, "inputs": frozen_inputs, "schema": canonical_schema,
            "schema_sha256": digest(canonical_schema), "batches": emitter.batches, "artifacts": artifacts,
            "migration_ledger": migration_ledger,
            "expected": {"file": "expected.sqlite", "byte_hash_receipt": "expected.sqlite.sha256",
                         "logical_sha256": canonical_inventory["logical_snapshot_sha256"],
                         "policy": "Non-executable evidence: byte receipt alone contains runtime seed and Wrangler applied_at timestamps."},
            "limits": {"statement_bytes": STATEMENT_BYTES, "batch_bytes": BATCH_BYTES, "data_rows": BATCH_ROWS,
                       "stored_row_bytes": MAX_ROW_BYTES, "estimated_rows_written": BATCH_ESTIMATED_WRITES,
                       "indivisible_group_estimated_rows_written": MAX_GROUP_ESTIMATED_WRITES},
            "estimate_policy": canonical_inventory["estimate_policy"]}
    # Fail closed if any input changed while building, not merely on next resume.
    if inputs(preparation_path, source_path, manifest_path, migrations_dir) != frozen_inputs:
        raise ValueError("immutable inputs changed during build")
    plan["plan_id"] = plan_digest(plan)
    plan["candidate_name"] = "workshop-staging-migrate-" + plan["plan_id"][:12]
    json_write(output_dir / "plan.json", plan)
    return plan


def artifact_path(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError("invalid relative artifact path")
    path = (root / relative).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("artifact escapes plan directory")
    return path


def validate_plan(plan_path):
    """Validate immutable execution inputs, utilities, batches and evidence seals."""
    plan_path = Path(plan_path)
    root = plan_path.resolve().parent
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if (plan.get("format") != FORMAT or plan.get("plan_id") != plan_digest(plan)
            or plan.get("candidate_name") != "workshop-staging-migrate-" + plan["plan_id"][:12]):
        raise ValueError("invalid plan identity")
    frozen = plan["inputs"]
    current = inputs(frozen["preparation"]["path"], frozen["source"]["path"], frozen["manifest"]["path"],
                     frozen["migrations_dir"])
    if current != frozen:
        raise ValueError("immutable input, utility, or migration chain changed")
    if digest(plan["schema"]) != plan["schema_sha256"]:
        raise ValueError("canonical schema hash differs")
    for artifact in plan["artifacts"].values():
        if file_hash(artifact_path(root, artifact["file"])) != artifact["sha256"]:
            raise ValueError("sealed evidence artifact changed")
    for index, batch in enumerate(plan["batches"], 1):
        if batch["id"] != f"{index:06d}":
            raise ValueError("invalid batch ordering")
        path = artifact_path(root, batch["file"])
        if file_hash(path) != batch["sha256"]:
            raise ValueError("sealed batch SQL changed")
        sql = path.read_text(encoding="utf-8")
        split = statements(sql)
        if (len(split) != batch["statement_count"] or len(sql.encode("utf-8")) != batch["bytes"]
                or any(len(statement.encode("utf-8")) > STATEMENT_BYTES for statement in split)
                or batch["data_rows"] > BATCH_ROWS
                or not 0 < batch["estimated_rows_written"] <= MAX_GROUP_ESTIMATED_WRITES
                or (batch["bytes"] > BATCH_BYTES and not (batch["single_large_row"] and batch["data_rows"] == 1))):
            raise ValueError("invalid bounded batch metadata")
    saved_inventory = json.loads(artifact_path(root, "inventory.json").read_text(encoding="utf-8"))
    if saved_inventory["schema"] != plan["schema"] or saved_inventory["schema_sha256"] != plan["schema_sha256"]:
        raise ValueError("schema inventory differs from plan")
    receipt = json.loads(artifact_path(root, plan["expected"]["byte_hash_receipt"]).read_text(encoding="utf-8"))
    expected = artifact_path(root, plan["expected"]["file"])
    if receipt != {"file": "expected.sqlite", "sha256": file_hash(expected)}:
        raise ValueError("sealed expected snapshot changed")
    db = sqlite3.connect(expected.as_uri() + "?mode=ro", uri=True)
    try:
        if validate_ledger(db, frozen["migrations"]) != plan["migration_ledger"]:
            raise ValueError("expected snapshot Wrangler migration ledger differs")
        if schema(db) != plan["schema"] or rows_digest(db) != plan["expected"]["logical_sha256"]:
            raise ValueError("expected snapshot schema or logical rows differ")
    finally:
        db.close()
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("preparation", "source", "manifest", "migrations", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        plan = build(args.preparation, args.source, args.manifest, args.migrations, args.output)
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error, OverflowError):
        print(json.dumps({"ok": False, "error": "offline_plan_input_or_schema_error"}))
        return 1
    print(json.dumps({"ok": True, "format": FORMAT, "plan_id": plan["plan_id"],
                      "candidate_name": plan["candidate_name"], "batch_count": len(plan["batches"])}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

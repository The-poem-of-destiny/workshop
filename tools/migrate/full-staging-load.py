#!/usr/bin/env python3
"""Replace staging D1 data from a validated full-snapshot preparation.

This command performs remote writes only with all three explicit confirmations.
It records a Time Travel bookmark and retains private snapshots and artifacts.
The deployed staging schema is not permanently modified. Stop every staging
writer, verify R2 objects, and keep writers stopped through reconciliation.
"""
from __future__ import annotations

from collections import Counter
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
DATABASE = "7500b5f6-21a0-4dfd-9e16-0d9a4f9de476"
PRESERVED = {"site_settings", "client_channels"}
DERIVED = {"project_search", "project_search_short", "project_search_tags"}
FTS_SHADOWS = {prefix + "_" + suffix for prefix in ("project_search", "project_search_short")
               for suffix in ("config", "content", "data", "docsize", "idx")}


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


validator = module("full_validate_staging", "full-validate.py")
loader = module("full_load_staging", "full-load.py")
importer = module("full_d1_import_staging", "full-d1-import.py")
quote = validator.quote


def value(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return "CAST(X'" + v.encode("utf-8").hex() + "' AS TEXT)"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float) and math.isfinite(v):
        return repr(v)
    raise ValueError("unsupported SQL value")


def child_environment(home):
    token = os.environ.get("STAGING_IMPORT_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token:
        raise ValueError("STAGING_IMPORT_TOKEN is required; inject an authorized staging credential")
    if not account:
        raise ValueError("CLOUDFLARE_ACCOUNT_ID is required")
    return {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home),
        "TMPDIR": os.environ.get("TMPDIR", tempfile.gettempdir()),
        "CI": "1",
        "WRANGLER_SEND_METRICS": "false",
        "CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV": "false",
        "HTTPS_PROXY": os.environ.get("HTTPS_PROXY", os.environ.get("https_proxy", "")),
        "HTTP_PROXY": os.environ.get("HTTP_PROXY", os.environ.get("http_proxy", "")),
        "NO_PROXY": os.environ.get("NO_PROXY", os.environ.get("no_proxy", "")),
        "CLOUDFLARE_API_TOKEN": token,
        "CLOUDFLARE_ACCOUNT_ID": account,
    }


def redacted_wrangler_stderr(stderr):
    return importer.sanitize_text(stderr.decode("utf-8", errors="replace"))


def wrangler(config, *args, remote=True, include_stderr=False):
    home = config.parent / ".wrangler-home"
    command = [str(ROOT / "apps/worker/node_modules/.bin/wrangler"), "d1", *args,
               "--config", str(config)]
    if remote:
        command.append("--remote")
    result = subprocess.run(command, cwd=home, env=child_environment(home),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        diagnostic = {
            "operation": " ".join(args[:1]),
            "exit_status": result.returncode,
            "stdout": redacted_wrangler_stderr(result.stdout),
            "stderr": redacted_wrangler_stderr(result.stderr),
        }
        path = config.parent / "wrangler-failure.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(diagnostic, out, ensure_ascii=True, indent=2)
            out.write("\n")
        raise RuntimeError("Wrangler failed; inspect staging and retained artifacts before any retry")
    return (result.stdout + (result.stderr if include_stderr else b"")).decode("utf-8")


VERIFIED_QUERY_TARGETS = set()


def query_target(config, account):
    databases = json.loads(config.read_text(encoding="utf-8")).get("d1_databases")
    if not isinstance(databases, list) or len(databases) != 1 or not isinstance(databases[0], dict):
        raise ValueError("expected exactly one staging or dedicated rehearsal D1 target")
    target = databases[0]
    database = target.get("database_id")
    name = target.get("database_name")
    if database == DATABASE and name == "workshop-staging":
        return database
    if name != importer.PROBE_NAME:
        raise ValueError("D1 query target is not staging or the exact dedicated rehearsal name")
    identity = (str(config.resolve()), account, database, name)
    if identity not in VERIFIED_QUERY_TARGETS:
        importer.validate_target(database)
        VERIFIED_QUERY_TARGETS.add(identity)
    return database


def query(config, sql):
    env = child_environment(config.parent / ".wrangler-home")
    account = env["CLOUDFLARE_ACCOUNT_ID"]
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
        raise ValueError("invalid Cloudflare account ID")
    database = query_target(config, account)
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/query"
    request = Request(url, data=json.dumps({"sql": sql}).encode(), method="POST", headers={
        "Authorization": "Bearer " + env["CLOUDFLARE_API_TOKEN"],
        "Content-Type": "application/json",
    })
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.load(response)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise RuntimeError("staging D1 query failed") from exc
    result = payload.get("result")
    if payload.get("success") is not True or not isinstance(result, list) or len(result) != 1 or result[0].get("success") is not True:
        raise ValueError("unexpected D1 query response")
    rows = result[0].get("results")
    if not isinstance(rows, list):
        raise ValueError("missing D1 query rows")
    return rows


def bookmark(config):
    output = wrangler(config, "time-travel", "info", "workshop-staging", remote=False, include_stderr=True)
    matches = set(re.findall(r"\b[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}\b", output, re.I))
    if len(matches) != 1:
        raise ValueError("could not establish a unique D1 Time Travel bookmark")
    return matches.pop()


def decode_cell(cell):
    kind, data = json.loads(cell)
    if kind == "null" and data is None:
        return None
    if kind == "integer" and isinstance(data, str):
        return int(data)
    if kind == "real" and isinstance(data, str):
        result = float(data)
        if math.isfinite(result):
            return result
    if kind in ("text", "blob") and isinstance(data, str):
        result = bytes.fromhex(data)
        return result.decode("utf-8") if kind == "text" else result
    raise ValueError("unsupported SQLite value in staging snapshot")


def snapshot(config, migrations, path, expected):
    schema_rows = query(config, "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL "
                        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'")
    remote_schema = {(r["type"], r["name"]): " ".join(r["sql"].split()) for r in schema_rows}
    if remote_schema != expected:
        raise ValueError("staging schema differs from the supplied deployed migration chain")
    db = sqlite3.connect(path)
    try:
        for migration in validator.migration_files(migrations):
            db.executescript(migration.read_text(encoding="utf-8"))
        db.execute("PRAGMA foreign_keys = OFF")
        triggers = list(db.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL"))
        for name, _ in triggers:
            db.execute("DROP TRIGGER " + quote(name))
        names = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
                 if not r[0].startswith(("sqlite_", "_cf_")) and r[0] not in FTS_SHADOWS}
        for name in sorted(names):
            db.execute("DELETE FROM " + quote(name))
        for name in sorted(names):
            columns = [r[1] for r in db.execute("PRAGMA table_xinfo(" + quote(name) + ")") if r[6] == 0]
            expressions = []
            for column in columns:
                c = quote(column)
                expressions.append("json_array(typeof(" + c + "), CASE typeof(" + c + ") "
                    "WHEN 'text' THEN hex(" + c + ") WHEN 'blob' THEN hex(" + c + ") "
                    "WHEN 'integer' THEN CAST(" + c + " AS TEXT) WHEN 'real' THEN printf('%!.17g'," + c + ") "
                    "ELSE NULL END)")
            count_sql = "SELECT CAST(count(*) AS TEXT) AS n FROM " + quote(name)
            expected_count = int(query(config, count_sql)[0]["n"])
            last = None
            weight = " + ".join("COALESCE(length(CAST(" + quote(c) + " AS BLOB)), 0) * 2 + 80"
                                for c in columns) or "80"
            total = 0
            while True:
                lower = " WHERE rowid > " + str(last) if last is not None else ""
                sizes = query(config, "SELECT CAST(rowid AS TEXT) AS rid, " + weight +
                              " AS bytes FROM " + quote(name) + lower + " ORDER BY rowid LIMIT 500")
                if not sizes:
                    break
                page_bytes = 0
                upper = None
                for candidate in sizes:
                    size = int(candidate["bytes"])
                    if upper is not None and page_bytes + size > 1_000_000:
                        break
                    upper = int(candidate["rid"])
                    page_bytes += size
                fields = ", ".join(expr + " AS " + quote("c" + str(i)) for i, expr in enumerate(expressions))
                bounds = (" WHERE rowid > " + str(last) + " AND " if last is not None else " WHERE ")
                statement = ("SELECT CAST(rowid AS TEXT) AS rid" + (", " + fields if fields else "") +
                             " FROM " + quote(name) + bounds + "rowid <= " + str(upper))
                rows = query(config, statement + " ORDER BY rowid")
                if not rows or int(rows[-1]["rid"]) != upper:
                    raise ValueError("staging snapshot page changed during read")
                for row in rows:
                    rowid = int(row["rid"])
                    if last is not None and rowid <= last:
                        raise ValueError("unstable staging snapshot pagination")
                    values = [decode_cell(row["c" + str(i)]) for i in range(len(columns))]
                    db.execute("INSERT INTO " + quote(name) + " (rowid, " + ", ".join(map(quote, columns)) +
                               ") VALUES (" + ", ".join("?" for _ in range(len(columns) + 1)) + ")",
                               [rowid, *values])
                    last = rowid
                    total += 1
            if total != expected_count or int(query(config, count_sql)[0]["n"]) != total:
                raise ValueError("staging table changed during snapshot")
        for _, sql in triggers:
            db.execute(sql)
        db.commit()
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok" or list(db.execute("PRAGMA foreign_key_check")):
            raise ValueError("snapshot integrity or foreign key check failed")
        for name in ("project_search", "project_search_short"):
            db.execute("INSERT INTO " + quote(name) + " (" + quote(name) + ") VALUES ('integrity-check')")
        db.commit()
        return db
    except BaseException:
        db.close()
        raise


def schema(db):
    return {(kind, name): " ".join(sql.split()) for kind, name, sql in db.execute(
        "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'")}


def expected_schema(migrations):
    files = validator.migration_files(migrations)
    if len(files) != 25 or files[-1].name != "0025_remove_public_cache_epoch.sql":
        raise ValueError("expected deployed staging migration chain through 0025")
    db = sqlite3.connect(":memory:")
    try:
        for path in files:
            db.executescript(path.read_text(encoding="utf-8"))
        return schema(db)
    finally:
        db.close()


SQL_STATEMENT_LIMIT = 100_000
TEXT_CHUNK_BYTES = 32_000


def key_columns(db, table, all_tables):
    keys = {row[1] for row in db.execute("PRAGMA table_info(" + quote(table) + ")") if row[5]}
    for index in db.execute("PRAGMA index_list(" + quote(table) + ")"):
        if index[2]:
            for column in db.execute("PRAGMA index_xinfo(" + quote(index[1]) + ")"):
                if column[5]:
                    if column[1] < 0:
                        return None
                    keys.add(column[2])
    for child in all_tables:
        for fk in db.execute("PRAGMA foreign_key_list(" + quote(child) + ")"):
            if child == table:
                keys.add(fk[3])
            if fk[2] == table and fk[4] is not None:
                keys.add(fk[4])
    return keys


def insert_row(db, table, row, all_tables, lines, chunks_created, chunk_table):
    keys = list(row)
    if not keys:
        lines.append("INSERT INTO " + quote(table) + " DEFAULT VALUES;")
        return chunks_created
    prefix = "INSERT INTO " + quote(table) + " (" + ", ".join(map(quote, keys)) + ") VALUES ("
    rendered = [value(row[key]) for key in keys]
    statement = prefix + ", ".join(rendered) + ");"
    if len(statement.encode("utf-8")) < SQL_STATEMENT_LIMIT:
        lines.append(statement)
        return chunks_created

    protected = key_columns(db, table, all_tables)
    candidates = sorted((i for i, key in enumerate(keys)
                         if isinstance(row[key], str) and protected is not None and key not in protected),
                        key=lambda i: len(rendered[i]), reverse=True)
    selected = []
    for i in candidates:
        expression = ('(SELECT group_concat(piece, \'\') FROM (SELECT CAST(data AS TEXT) AS piece '
                      'FROM ' + quote(chunk_table) + ' WHERE field = ' + str(i) + ' ORDER BY part))')
        if len(expression) >= len(rendered[i]):
            continue
        selected.append(i)
        rendered[i] = expression
        statement = prefix + ", ".join(rendered) + ");"
        if len(statement.encode("utf-8")) < SQL_STATEMENT_LIMIT:
            break
    if len(statement.encode("utf-8")) >= SQL_STATEMENT_LIMIT:
        raise ValueError("oversized SQL statement contains unsupported large keys, blobs, or row structure: " + table)
    if not chunks_created:
        lines.insert(1, "CREATE TABLE " + quote(chunk_table) +
                     " (field INTEGER NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL);")
        chunks_created = True
    for i in selected:
        data = row[keys[i]].encode("utf-8")
        for part, start in enumerate(range(0, len(data), TEXT_CHUNK_BYTES)):
            lines.append('INSERT INTO ' + quote(chunk_table) + ' VALUES (' + str(i) + ", " + str(part) +
                         ", X'" + data[start:start + TEXT_CHUNK_BYTES].hex() + "');")
    lines.append(statement)
    lines.append('DELETE FROM ' + quote(chunk_table) + ';')
    return chunks_created


def build_sql(db, tables):
    all_tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")
                  if not r[0].startswith(("sqlite_", "_cf_")) and r[0] != "d1_migrations"}
    writable = all_tables - PRESERVED - DERIVED - FTS_SHADOWS
    if not set(tables) <= writable:
        raise ValueError("preparation contains a protected or unknown table")
    # Preserve the audit identity in site settings across replacement of users.
    settings = list(db.execute("SELECT key, updated_by FROM site_settings WHERE updated_by IS NOT NULL"))
    cache_epoch = db.execute("SELECT value, updated_at, updated_by FROM site_settings WHERE key = 'cache_epoch'").fetchone()
    user_ids = {row.get("id") for row in tables.get("users", [])}
    if any(user not in user_ids for _, user in settings):
        raise ValueError("site_settings references a user absent from the preparation")
    order = validator.order_tables(db, writable)
    lines = ["PRAGMA defer_foreign_keys = ON;"]
    chunks_created = False
    chunk_table = "_workshop_import_text_chunks_" + uuid.uuid4().hex
    for name in reversed(order):
        lines.append("DELETE FROM " + quote(name) + ";")
    for name in validator.order_tables(db, set(tables)):
        if name in ("project_metrics_daily", "project_like_events") and "project_likes" in tables:
            lines.append("DELETE FROM " + quote(name) + ";")
        for row in tables[name]:
            chunks_created = insert_row(db, name, row, all_tables, lines, chunks_created, chunk_table)
    for name in ("project_metrics_daily", "project_like_events"):
        if name in writable and name not in tables:
            lines.append("DELETE FROM " + quote(name) + ";")
    if "project_like_events" in writable and "project_like_events" not in tables:
        lines.append(
            "INSERT INTO project_like_events (project_id, delta, occurred_at, source) "
            "SELECT project_id, likes_delta, day_key || 'T00:00:00.000Z', 'legacy_daily' "
            "FROM project_metrics_daily WHERE likes_delta <> 0;"
        )
    for row in tables.get("projects", []):
        fields = [k for k in ("likes_count", "subscriptions_count", "downloads_count") if k in row]
        if fields:
            lines.append("UPDATE projects SET " + ", ".join(quote(k) + " = " + value(row[k]) for k in fields) +
                         " WHERE id = " + value(row["id"]) + ";")
    for key, user in settings:
        lines.append("UPDATE site_settings SET updated_by = " + value(user) + " WHERE key = " + value(key) + ";")
    if cache_epoch is None:
        lines.append("DELETE FROM site_settings WHERE key = 'cache_epoch';")
    else:
        lines.append("UPDATE site_settings SET value = " + value(cache_epoch[0]) +
                     ", updated_at = " + value(cache_epoch[1]) + ", updated_by = " + value(cache_epoch[2]) +
                     " WHERE key = 'cache_epoch';")
    if chunks_created:
        lines.append('DROP TABLE ' + quote(chunk_table) + ';')
    if any(len(statement.encode("utf-8")) >= SQL_STATEMENT_LIMIT for statement in lines):
        raise ValueError("generated SQL statement exceeds the D1 size limit")
    return "\n".join(lines) + "\n"


def preserved_rows(db):
    present = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    return {name: Counter(db.execute("SELECT * FROM " + quote(name)).fetchall())
            for name in PRESERVED if name in present}


def private_write(path, text):
    with path.open("x", encoding="utf-8") as out:
        out.write(text)


def run(args):
    child_environment(args.artifacts.resolve() / ".wrangler-home")
    data = loader.preparation(args.preparation)
    source_report = loader.source_reconcile(data, args.source, args.manifest)
    if not source_report["ok"]:
        raise ValueError("source reconciliation failed: " + json.dumps(source_report, ensure_ascii=True))
    data = dict(data, tables={k: v for k, v in data["tables"].items() if k not in PRESERVED})
    report = validator.validate(data, args.migrations)
    if not report["ok"]:
        raise ValueError("preparation validation failed: " + json.dumps(report, ensure_ascii=True))
    expected = expected_schema(args.migrations)
    directory = args.artifacts.resolve()
    if directory == ROOT or ROOT in directory.parents:
        raise ValueError("artifacts directory must be outside the repository")
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    (directory / ".wrangler-home").mkdir(mode=0o700)
    config = directory / "wrangler.json"
    private_write(config, json.dumps({"name": "workshop-staging-import", "compatibility_date": "2026-10-20",
                                     "d1_databases": [{"binding": "DB", "database_name": "workshop-staging",
                                                       "database_id": DATABASE}]}))
    recovery_bookmark = bookmark(config)
    private_write(directory / "time-travel-bookmark.txt", recovery_bookmark + "\n")
    backup = directory / "before.sqlite"
    db = snapshot(config, args.migrations, backup, expected)
    try:
        restored = sqlite3.connect(directory / "rehearsal.sqlite")
        try:
            db.backup(restored)
            if restored.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("local snapshot restore integrity check failed")
            if list(restored.execute("PRAGMA foreign_key_check")):
                raise ValueError("local snapshot restore foreign key check failed")
            if schema(restored) != expected:
                raise ValueError("local snapshot restore schema mismatch")
        finally:
            restored.close()
    finally:
        db.close()
    private_write(directory / "before.sha256", hashlib.sha256(backup.read_bytes()).hexdigest() + "  before.sqlite\n")
    db = sqlite3.connect(directory / "rehearsal.sqlite")
    try:
        if schema(db) != expected:
            raise ValueError("staging schema differs from the supplied deployed migration chain")
        preserved = preserved_rows(db)
        sql = build_sql(db, data["tables"])
        private_write(directory / "load.sql", sql)
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript("BEGIN;\n" + sql + "COMMIT;")
        if list(db.execute("PRAGMA foreign_key_check")):
            raise ValueError("local rehearsal has foreign key violations")
        if preserved_rows(db) != preserved:
            raise ValueError("local rehearsal changed protected site configuration")
    finally:
        db.close()
    rehearsal = loader.reconcile(data, directory / "rehearsal.sqlite")
    if not rehearsal["ok"]:
        raise ValueError("local rehearsal reconciliation failed: " + json.dumps(rehearsal, ensure_ascii=True))
    imported = importer.execute(DATABASE, directory / "load.sql", directory / "d1-import")
    if not imported["ok"]:
        raise RuntimeError("D1 import failed; inspect private import receipts and keep staging writers stopped")
    db = snapshot(config, args.migrations, directory / "after.sqlite", expected)
    try:
        if schema(db) != expected or preserved_rows(db) != preserved:
            raise ValueError("post-load schema or protected site configuration changed")
    finally:
        db.close()
    result = loader.reconcile(data, directory / "after.sqlite")
    result["source_checks"] = source_report
    result["source_reconciliation_verified"] = source_report["ok"]
    private_write(directory / "reconciliation.json", json.dumps(result, ensure_ascii=True, indent=2) + "\n")
    if not result["ok"]:
        raise ValueError("post-load reconciliation failed; keep staging writers stopped")
    return {"ok": True, "database_id": DATABASE, "backup_sha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
            "recovery_bookmark": recovery_bookmark, "artifacts": str(directory),
            "preserved_tables": sorted(PRESERVED), "reconciliation": result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preparation", type=Path)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--migrations", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True, help="new private directory outside the repository")
    parser.add_argument("--confirm-staging-replacement", action="store_true", required=True)
    parser.add_argument("--writers-stopped", action="store_true", required=True)
    parser.add_argument("--r2-verified", action="store_true", required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(run(args), ensure_ascii=True, indent=2))
        return 0
    except (OSError, UnicodeError, ValueError, TypeError, sqlite3.Error, RuntimeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=True), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Typed read-only D1 snapshots and bounded SQL row encoding."""
from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path
import sqlite3

FTS_SHADOWS = {prefix + "_" + suffix for prefix in ("project_search", "project_search_short")
               for suffix in ("config", "content", "data", "docsize", "idx")}


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


validator = module("full_validate_staging", "full-validate.py")
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


def snapshot(query, migrations, path, expected):
    schema_rows = query("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL "
                        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")
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
            expected_count = int(query(count_sql)[0]["n"])
            last = None
            weight = " + ".join("COALESCE(length(CAST(" + quote(c) + " AS BLOB)), 0) * 2 + 80"
                                for c in columns) or "80"
            total = 0
            while True:
                lower = " WHERE rowid > " + str(last) if last is not None else ""
                sizes = query("SELECT CAST(rowid AS TEXT) AS rid, " + weight +
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
                rows = query(statement + " ORDER BY rowid")
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
            if total != expected_count or int(query(count_sql)[0]["n"]) != total:
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
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")}




SQL_STATEMENT_LIMIT = 64_000
TEXT_CHUNK_BYTES = 30_000


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
    if len(statement.encode("utf-8")) <= SQL_STATEMENT_LIMIT:
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
        if len(statement.encode("utf-8")) <= SQL_STATEMENT_LIMIT:
            break
    if len(statement.encode("utf-8")) > SQL_STATEMENT_LIMIT:
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


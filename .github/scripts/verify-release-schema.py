"""Compare the target DB binding with the exact checked-out migration chain, without writing to D1."""

import argparse
import json
from pathlib import Path
import sqlite3
import subprocess
import sys


WORKER = Path(__file__).resolve().parents[2] / "apps" / "worker"
SCHEMA_QUERY = """
SELECT type, name, sql FROM sqlite_schema
WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'
  AND name != 'd1_migrations'
ORDER BY type, name
"""


def local_schema():
    files = sorted((WORKER / "migrations").glob("*.sql"))
    if not files:
        raise ValueError("No checked-out D1 migrations.")
    with sqlite3.connect(":memory:") as db:
        for file in files:
            db.executescript(file.read_text(encoding="utf-8"))
        return {(kind, name): sql for kind, name, sql in db.execute(SCHEMA_QUERY)}


def target_schema(environment):
    raw = subprocess.check_output(
        ["./node_modules/.bin/wrangler", "d1", "execute", "DB", "--env", environment,
         "--config", "wrangler.jsonc", "--remote", "--json", "--command", SCHEMA_QUERY],
        cwd=WORKER, text=True,
    )
    result, = json.loads(raw)
    if result.get("success") is not True:
        raise ValueError("Could not read target D1 schema.")
    rows = result["results"]
    schema = {(row["type"], row["name"]): row["sql"] for row in rows}
    if len(schema) != len(rows):
        raise ValueError("Duplicate objects in target D1 schema response.")
    return schema


def verify(environment):
    expected = local_schema()
    actual = target_schema(environment)
    missing = sorted(expected.keys() - actual.keys())
    extra = sorted(actual.keys() - expected.keys())
    changed = sorted(key for key in expected.keys() & actual.keys() if expected[key] != actual[key])
    if missing or extra or changed:
        raise ValueError(f"{environment} D1 schema mismatch; missing={missing}, extra={extra}, changed={changed}. "
                         "Verify the binding and apply approved migrations separately before retrying.")
    print(f"{environment} D1 schema verified: {len(expected)} objects.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("environment", choices=("staging", "production"))
    try:
        verify(parser.parse_args().environment)
    except (KeyError, OSError, TypeError, ValueError, sqlite3.Error, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)

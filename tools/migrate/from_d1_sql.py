#!/usr/bin/env python3
"""Convert a legacy D1 SQL dump plus an R2 tree into migration JSON files.

Usage:
  python3 tools/migrate/from_d1_sql.py data_backup/d1-export.sql data_backup/r2 /tmp/legacy-export

The output directory is disposable rehearsal data and must never be committed.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

MIME = {
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size


def entry_count(path: Path, kind: str) -> int:
    if kind not in ("worldbook", "regex"):
        return 0
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return 0
    if isinstance(parsed, list):
        return len(parsed)
    if not isinstance(parsed, dict):
        return 0
    if kind == "worldbook":
        values = parsed.get("entries", parsed)
    else:
        values = parsed.get("regexes", parsed.get("entries", parsed))
    if isinstance(values, list):
        return len(values)
    if isinstance(values, dict):
        return len(values)
    return 0


def url_key(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    path = unquote(parsed.path)
    marker = "/api/files/"
    if marker in path:
        key = path.split(marker, 1)[1]
    elif not parsed.scheme and not parsed.netloc:
        # Legacy rows also store bare R2 keys such as projects/<id>/cover.png.
        key = path
    else:
        return None
    key = key.lstrip("/")
    if not key or ".." in Path(key).parts:
        return None
    return key


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    dump, r2_root, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(":memory:")
    db.executescript(dump.read_text(encoding="utf-8"))
    db.row_factory = sqlite3.Row

    tables = [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]
    admins = {row[0] for row in db.execute("SELECT user_id FROM admins")} if "admins" in tables else set()
    super_admins = {row[0] for row in db.execute("SELECT user_id FROM super_admins")} if "super_admins" in tables else set()
    rows_by_table: dict[str, list[dict]] = {}
    for table in tables:
        rows = [dict(row) for row in db.execute(f'SELECT * FROM "{table}"')]
        if table == "users":
            for row in rows:
                if row["id"] in super_admins:
                    row["role"] = "owner"
                elif row["id"] in admins or row.get("is_admin"):
                    row["role"] = "reviewer"
        rows_by_table[table] = rows
        (out_dir / f"{table}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    assets: list[dict] = []
    missing: list[str] = []
    skipped: list[str] = []
    for row in rows_by_table.get("projects", []):
        project_id = row.get("id")
        if not project_id:
            continue
        for kind, field in (("cover", "cover_image"), ("worldbook", "download_url")):
            value = row.get(field)
            key = url_key(value)
            if not key:
                if value:
                    skipped.append(f"{project_id}:{field}={value}")
                continue
            name = key.rsplit("/", 1)[-1]
            if kind == "worldbook":
                kind = "regex" if name.startswith("regex-") else "worldbook"
            path = r2_root / key
            if not path.is_file():
                missing.append(key)
                continue
            sha256, size = digest(path)
            assets.append({
                "id": f"legacy-asset-{project_id}-{kind}",
                "project_id": project_id,
                "kind": kind,
                "r2_key": key,
                "sha256": sha256,
                "bytes": size,
                "mime": MIME.get(path.suffix.lower(), "application/octet-stream"),
                "entry_count": entry_count(path, kind),
                "created_at": row.get("updated_at") or row.get("created_at"),
            })

    project_rows = {row["id"]: row for row in rows_by_table.get("projects", []) if row.get("id")}
    seen = {(asset["project_id"], asset["kind"]) for asset in assets}
    for path in sorted((r2_root / "projects").glob("*/regex-*.json")):
        project_id = path.parent.name
        row = project_rows.get(project_id)
        if row is None or (project_id, "regex") in seen:
            continue
        seen.add((project_id, "regex"))
        sha256, size = digest(path)
        assets.append({
            "id": f"legacy-asset-{project_id}-regex",
            "project_id": project_id,
            "kind": "regex",
            "r2_key": path.relative_to(r2_root).as_posix(),
            "sha256": sha256,
            "bytes": size,
            "mime": MIME.get(path.suffix.lower(), "application/octet-stream"),
            "entry_count": entry_count(path, "regex"),
            "created_at": row.get("updated_at") or row.get("created_at"),
        })

    (out_dir / "assets.json").write_text(
        json.dumps(assets, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"exported {len(tables)} tables, {len(assets)} assets, "
        f"{len(missing)} missing R2 objects, {len(skipped)} unrecognized fields"
    )
    for key in missing[:20]:
        print(f"  missing: {key}", file=sys.stderr)
    for value in skipped[:20]:
        print(f"  skipped: {value}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

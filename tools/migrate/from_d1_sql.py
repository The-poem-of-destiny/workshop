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


def url_key(value: str | None) -> str | None:
    if not value:
        return None
    path = unquote(urlparse(value).path)
    marker = "/api/files/"
    if marker in path:
        return path.split(marker, 1)[1].lstrip("/")
    return None


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
    rows_by_table: dict[str, list[dict]] = {}
    for table in tables:
        rows = [dict(row) for row in db.execute(f'SELECT * FROM "{table}"')]
        rows_by_table[table] = rows
        (out_dir / f"{table}.json").write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    assets: list[dict] = []
    missing: list[str] = []
    for row in rows_by_table.get("projects", []):
        project_id = row.get("id")
        if not project_id:
            continue
        for kind, field in (("cover", "cover_image"), ("worldbook", "download_url")):
            key = url_key(row.get(field))
            if not key:
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
                "created_at": row.get("updated_at") or row.get("created_at"),
            })

    (out_dir / "assets.json").write_text(
        json.dumps(assets, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"exported {len(tables)} tables, {len(assets)} assets, {len(missing)} missing R2 objects")
    for key in missing[:20]:
        print(f"  missing: {key}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Create an explicit, disposable public-release export from a legacy D1 dump.

Usage:
  python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/public-export

Only legacy projects with status='approved', is_published=1, and visibility=1
are exported. The output contains users.json, projects.json, and assets.json;
asset bytes are embedded solely so the local importer can verify SHA-256 and
validate current released content. No role, session, review, interaction, or
site-configuration data is exported.
"""
from __future__ import annotations

import base64
import hashlib
import json
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

USER_FIELDS = ("id", "username", "global_name", "avatar", "created_at", "updated_at")
PROJECT_FIELDS = (
    "id", "author_id", "name", "description", "project_type", "extension_type", "tags",
    "status", "is_published", "visibility", "created_at", "updated_at",
    "latest_approved_at", "reviewed_at", "version_label", "version", "precautions",
    "cover_position_x", "cover_position_y", "cover_zoom", "discord_thread_url",
    "cover_image", "download_url",
)


def exported_fields(row: dict, fields: tuple[str, ...]) -> dict:
    return {field: row.get(field) for field in fields if field in row}


def digest(path: Path) -> tuple[str, int, bytes]:
    payload = path.read_bytes()
    return hashlib.sha256(payload).hexdigest(), len(payload), payload


def url_key(value: str | None) -> str | None:
    if not value:
        return None
    parsed = urlparse(value)
    raw_path = unquote(parsed.path)
    marker = "/api/files/"
    if marker in raw_path:
        key = raw_path.split(marker, 1)[1]
    elif not parsed.scheme and not parsed.netloc:
        key = raw_path
    else:
        return None
    key = key.lstrip("/")
    if not key or ".." in Path(key).parts:
        return None
    return key


def asset_row(project_id: str, kind: str, key: str, path: Path, created_at: str | None) -> dict:
    sha256, size, payload = digest(path)
    return {
        "id": f"legacy-asset-{project_id}-{kind}",
        "project_id": project_id,
        "kind": kind,
        "r2_key": key,
        "sha256": sha256,
        "bytes": size,
        "mime": MIME.get(path.suffix.lower(), "application/octet-stream"),
        "content_base64": base64.b64encode(payload).decode("ascii"),
        "created_at": created_at,
    }


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    dump, r2_root, out_dir = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    out_dir.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(":memory:")
    db.executescript(dump.read_text(encoding="utf-8"))
    db.row_factory = sqlite3.Row
    table_names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    required = {"users", "projects"}
    missing_tables = sorted(required - table_names)
    if missing_tables:
        print(f"missing legacy tables: {', '.join(missing_tables)}", file=sys.stderr)
        return 2

    projects = [
        exported_fields(dict(row), PROJECT_FIELDS)
        for row in db.execute(
            """SELECT * FROM projects
               WHERE status = 'approved' AND is_published = 1 AND visibility = 1
               ORDER BY id"""
        )
    ]
    author_ids = {row["author_id"] for row in projects if row.get("author_id")}
    users = [
        exported_fields(dict(row), USER_FIELDS)
        for row in db.execute(
            "SELECT * FROM users WHERE id IN ({}) ORDER BY id".format(",".join("?" for _ in author_ids) or "''"),
            tuple(sorted(author_ids)),
        )
    ]

    assets: list[dict] = []
    missing: list[str] = []
    skipped: list[str] = []
    for project in projects:
        project_id = project.get("id")
        if not project_id:
            continue
        created_at = project.get("updated_at") or project.get("created_at")
        for kind, value in (("cover", project.get("cover_image")), ("worldbook", project.get("download_url"))):
            key = url_key(value)
            if not key:
                if value:
                    skipped.append(f"{project_id}:{kind}:unrecognized_key")
                continue
            source = r2_root / key
            if not source.is_file():
                missing.append(key)
                continue
            assets.append(asset_row(project_id, kind, key, source, created_at))
        # Legacy regex content has one independent, documented object location.
        # download_url is always exported as worldbook; it is never reclassified by filename.
        regex_key = f"projects/{project_id}/regex-{project_id}.json"
        regex_path = r2_root / regex_key
        if regex_path.is_file():
            assets.append(asset_row(project_id, "regex", regex_key, regex_path, created_at))

    for name, rows in (("users", users), ("projects", projects), ("assets", assets)):
        (out_dir / f"{name}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"exported {len(projects)} public projects, {len(users)} member authors, {len(assets)} assets")
    for key in missing[:20]:
        print(f"  missing: {key}", file=sys.stderr)
    for value in skipped[:20]:
        print(f"  skipped: {value}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

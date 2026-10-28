#!/usr/bin/env python3
"""Create an explicit, disposable public-release export from a legacy D1 dump.

Usage:
  python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/public-export
  python3 tools/migrate/from_d1_sql.py legacy.sql legacy-r2 /tmp/public-export \
    --exclude-ids existing-target.json --require-assets --dedupe-name-author \
    --order updated-desc --limit 100

Only legacy projects with status='approved', is_published=1, and visibility=1
are exported. The output contains users.json, projects.json, and assets.json;
asset bytes are embedded solely so the local importer can verify SHA-256 and
validate current released content. No role, session, review, interaction, or
site-configuration data is exported.

Selection flags are optional and only narrow that public set. `--exclude-ids`
accepts a JSON array, a migration target's expectedProjectIds, or one ID per
line. `--require-assets` drops projects whose cover or released content file is
absent instead of exporting them with partial resources. `--dedupe-name-author`
keeps the most recently updated project for an identical name and author.
When a flag narrows the set, selection.json records every dropped project so
the choice is auditable.
"""
from __future__ import annotations

import argparse
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


def read_id_set(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return {line.strip() for line in text.splitlines() if line.strip()}
    if isinstance(value, dict):
        value = value.get("ids") or value.get("meta", {}).get("expectedProjectIds") or []
    if not isinstance(value, list):
        raise SystemExit(f"{path}: expected a JSON array, expectedProjectIds, or one ID per line")
    return {str(item) for item in value}


def existing_asset(project: dict, r2_root: Path, key: str | None) -> bool:
    if not key:
        return False
    path = r2_root / key
    return path.is_file()


def main() -> int:
    parser = argparse.ArgumentParser(description="Export public legacy projects with explicit selection flags.")
    parser.add_argument("dump", type=Path)
    parser.add_argument("r2_root", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("--exclude-ids", type=Path, help="IDs already present at the destination")
    parser.add_argument("--include-ids", type=Path, help="export only these public project IDs")
    parser.add_argument("--require-assets", action="store_true", help="drop projects missing cover or content")
    parser.add_argument("--dedupe-name-author", action="store_true", help="keep the newest identical name+author")
    parser.add_argument("--order", choices=("id", "updated-desc"), default="id")
    parser.add_argument("--limit", type=int, help="export at most this many projects after filtering")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    dump, r2_root, out_dir = args.dump, args.r2_root, args.out_dir
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

    public_projects = [
        exported_fields(dict(row), PROJECT_FIELDS)
        for row in db.execute(
            """SELECT * FROM projects
               WHERE status = 'approved' AND is_published = 1 AND visibility = 1
               ORDER BY id"""
        )
    ]
    projects = list(public_projects)
    selection: dict = {"publicCount": len(public_projects)}
    narrowed = any(
        (args.exclude_ids, args.include_ids, args.require_assets, args.dedupe_name_author, args.limit)
    )

    if args.include_ids:
        include = read_id_set(args.include_ids)
        dropped = [row["id"] for row in projects if row["id"] not in include]
        projects = [row for row in projects if row["id"] in include]
        selection["notIncluded"] = dropped
    if args.exclude_ids:
        exclude = read_id_set(args.exclude_ids)
        dropped = [row["id"] for row in projects if row["id"] in exclude]
        projects = [row for row in projects if row["id"] not in exclude]
        selection["excludedExisting"] = dropped
    if args.require_assets:
        complete = []
        dropped = []
        for row in projects:
            cover_key = url_key(row.get("cover_image"))
            content_key = url_key(row.get("download_url"))
            missing = [
                kind
                for kind, key in (("cover", cover_key), ("content", content_key))
                if not existing_asset(row, r2_root, key)
            ]
            if missing:
                dropped.append({"id": row["id"], "missing": missing})
            else:
                complete.append(row)
        projects = complete
        selection["droppedMissingAssets"] = dropped
    if args.dedupe_name_author:
        kept: dict[tuple[str, str], dict] = {}
        dropped = []
        for row in projects:
            identity = (str(row.get("name") or ""), str(row.get("author_id") or ""))
            current = kept.get(identity)
            if current is None:
                kept[identity] = row
                continue
            winner, loser = (
                (row, current)
                if (row.get("updated_at") or "") > (current.get("updated_at") or "")
                else (current, row)
            )
            kept[identity] = winner
            dropped.append({"id": loser["id"], "kept": winner["id"], "reason": "same_name_author"})
        projects = list(kept.values())
        selection["deduped"] = dropped
    if args.order == "updated-desc":
        projects.sort(key=lambda row: (row.get("updated_at") or "", row["id"]), reverse=True)
    if args.limit is not None:
        dropped = [row["id"] for row in projects[args.limit :]]
        projects = projects[: args.limit]
        selection["overLimit"] = dropped
    if narrowed:
        selection["selected"] = [
            {
                "id": row["id"],
                "name": row.get("name"),
                "author_id": row.get("author_id"),
                "updated_at": row.get("updated_at"),
            }
            for row in projects
        ]
        selection["order"] = args.order
        selection["limit"] = args.limit
        (out_dir / "selection.json").write_text(
            json.dumps(selection, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

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

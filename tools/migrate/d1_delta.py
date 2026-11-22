"""Generate and self-verify incremental D1 SQL batches between two canonical SQLite snapshots."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3

HERE = Path(__file__).resolve().parent

ORDERED_BUSINESS_TABLES = (
    "users",
    "site_settings",
    "projects",
    "project_versions",
    "assets",
    "collections",
    "collection_projects",
    "submissions",
    "automated_reviews",
    "manual_reviews",
    "project_change_signals",
    "project_likes",
    "project_subscriptions",
    "project_experience_notes",
    "project_unversioned_notes",
    "project_metrics_daily",
    "download_daily_stats",
    "recommendation_batches",
    "recommendation_batch_activations",
    "recommendation_batch_eligibility",
    "recommendations",
    "audit_events",
    "oauth_flows",
    "sessions",
)

REPLICA_TABLES = (
    "public_cover_replicas",
    "public_gallery_replicas",
    "public_banner_replicas",
)


def load_module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sql_val(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, bytes):
        return f"X'{v.hex()}'"
    if isinstance(v, str):
        return "'" + v.replace("'", "''") + "'"
    raise TypeError(f"unsupported SQLite value: {type(v)}")


def quote(ident):
    return '"' + ident.replace('"', '""') + '"'


def table_columns_and_pk(db, table):
    info = list(db.execute(f"PRAGMA table_info({quote(table)})"))
    cols = [r[1] for r in info]
    pks = [r[1] for r in sorted((r for r in info if r[5] > 0), key=lambda r: r[5])]
    if not pks:
        raise ValueError(f"table {table} has no primary key")
    return cols, pks


def fetch_map(db, table, cols, pks):
    pk_idx = [cols.index(k) for k in pks]
    col_sql = ",".join(quote(c) for c in cols)
    rows = {}
    for row in db.execute(f"SELECT {col_sql} FROM {quote(table)}"):
        key = tuple(row[i] for i in pk_idx)
        rows[key] = row
    return rows


def where_pk(pks, key):
    return " AND ".join(f"{quote(col)} = {sql_val(val)}" for col, val in zip(pks, key))


def build_delta(from_path: Path, to_path: Path, out_dir: Path):
    planner = load_module("multiday-plan")
    os.umask(0o077)
    if out_dir.exists():
        raise ValueError("delta output directory already exists")
    src = sqlite3.connect(f"file:{from_path.resolve()}?mode=ro", uri=True)
    dst = sqlite3.connect(f"file:{to_path.resolve()}?mode=ro", uri=True)
    try:
        if planner.schema(src) != planner.schema(dst):
            raise ValueError("from-sqlite and to-sqlite schemas do not match")
        triggers = [(r["name"], r["sql"]) for r in planner.schema(dst) if r["type"] == "trigger"]
        search_trigger = dict(triggers).get("project_search_update")
        if not search_trigger:
            raise ValueError("missing project_search_update trigger")

        statements = []
        stats = {"inserted": 0, "updated": 0, "deleted": 0, "search_refreshed": 0}

        # 1. Suspend triggers during deterministic state transition
        for name, _ in triggers:
            statements.append(f"DROP TRIGGER IF EXISTS {quote(name)};")

        # 2. Withdraw changed/deleted public replicas BEFORE mutating projects/assets/site_settings
        for table in REPLICA_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            for key in sorted(old_rows.keys() - new_rows.keys()):
                statements.append(f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};")
                stats["deleted"] += 1
            for key in sorted(old_rows.keys() & new_rows.keys()):
                if old_rows[key] != new_rows[key]:
                    statements.append(f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};")

        # 3. Null out project pointers on projects being deleted or repointed before deleting versions/assets
        p_cols, p_pks = table_columns_and_pk(dst, "projects")
        old_projects = fetch_map(src, "projects", p_cols, p_pks)
        new_projects = fetch_map(dst, "projects", p_cols, p_pks)
        ptr_cols = ("working_version_id", "published_version_id", "published_cover_asset_id")
        ptr_idx = [p_cols.index(c) for c in ptr_cols]
        repointed_projects = []
        for key in sorted(old_projects.keys()):
            if key not in new_projects or any(old_projects[key][i] != new_projects[key][i] for i in ptr_idx):
                statements.append(
                    f"UPDATE \"projects\" SET working_version_id=NULL, published_version_id=NULL, published_cover_asset_id=NULL WHERE {where_pk(p_pks, key)};"
                )
                if key in new_projects:
                    repointed_projects.append(key)

        # 4. Delete removed rows in reverse dependency order
        for table in reversed(ORDERED_BUSINESS_TABLES):
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            for key in sorted(old_rows.keys() - new_rows.keys()):
                statements.append(f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};")
                stats["deleted"] += 1
                if table == "projects":
                    pid = key[0]
                    statements.append(f"DELETE FROM project_search_tags WHERE project_id = {sql_val(pid)};")

        # 5. Insert/update rows in forward dependency order (deferring project pointers until versions/assets exist)
        changed_search_projects = set()
        u_cols, u_pks = table_columns_and_pk(dst, "users")
        old_users = fetch_map(src, "users", u_cols, u_pks)
        new_users = fetch_map(dst, "users", u_cols, u_pks)
        changed_authors = {
            k[0]
            for k in (old_users.keys() & new_users.keys())
            if (old_users[k][u_cols.index("username")], old_users[k][u_cols.index("global_name")])
            != (new_users[k][u_cols.index("username")], new_users[k][u_cols.index("global_name")])
        }

        for table in ORDERED_BUSINESS_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            col_list = ",".join(quote(c) for c in cols)
            for key in sorted(new_rows.keys() - old_rows.keys()):
                row = list(new_rows[key])
                if table == "projects":
                    for i in ptr_idx:
                        row[i] = None
                    repointed_projects.append(key)
                    changed_search_projects.add(key[0])
                vals = ",".join(sql_val(v) for v in row)
                statements.append(f"INSERT INTO {quote(table)} ({col_list}) VALUES ({vals});")
                stats["inserted"] += 1
            for key in sorted(old_rows.keys() & new_rows.keys()):
                if old_rows[key] != new_rows[key]:
                    row = list(new_rows[key])
                    if table == "projects":
                        for i in ptr_idx:
                            if key in repointed_projects:
                                row[i] = None
                        changed_search_projects.add(key[0])
                    if table == "project_versions":
                        changed_search_projects.add(row[cols.index("project_id")])
                    assigns = ",".join(f"{quote(c)} = {sql_val(v)}" for c, v in zip(cols, row) if c not in pks)
                    if assigns:
                        statements.append(f"UPDATE {quote(table)} SET {assigns} WHERE {where_pk(pks, key)};")
                        stats["updated"] += 1

        # 6. Restore deferred project pointers
        for key in sorted(set(repointed_projects)):
            row = new_projects[key]
            assigns = ",".join(f"{quote(c)} = {sql_val(row[p_cols.index(c)])}" for c in ptr_cols)
            statements.append(f"UPDATE \"projects\" SET {assigns} WHERE {where_pk(p_pks, key)};")
            changed_search_projects.add(key[0])

        # Also refresh search for projects whose author display name changed or whose project was deleted
        if changed_authors:
            placeholders = ",".join(sql_val(a) for a in sorted(changed_authors))
            for (pid,) in dst.execute(f"SELECT id FROM projects WHERE author_id IN ({placeholders})"):
                changed_search_projects.add(pid)
        deleted_project_ids = {k[0] for k in (old_projects.keys() - new_projects.keys())}
        if deleted_project_ids or changed_search_projects:
            # Clean orphan FTS rowids for deleted projects
            statements.append("DELETE FROM project_search WHERE rowid NOT IN (SELECT rowid FROM projects WHERE published_version_id IS NOT NULL);")
            statements.append("DELETE FROM project_search_short WHERE rowid NOT IN (SELECT rowid FROM projects WHERE published_version_id IS NOT NULL);")
            for pid in sorted(changed_search_projects):
                statements.extend(planner.canonical_search_statements(search_trigger, pid, p_cols))
                stats["search_refreshed"] += 1

        # 7. Insert new/updated public image replicas
        for table in REPLICA_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            col_list = ",".join(quote(c) for c in cols)
            for key in sorted(new_rows.keys()):
                if key not in old_rows or old_rows[key] != new_rows[key]:
                    vals = ",".join(sql_val(v) for v in new_rows[key])
                    statements.append(f"INSERT INTO {quote(table)} ({col_list}) VALUES ({vals});")
                    stats["inserted"] += 1

        # 8. Restore canonical triggers
        for _, trig_sql in triggers:
            statements.append(trig_sql.rstrip().rstrip(";") + ";")

        # 9. Verify in-memory against to_sqlite!
        oracle = sqlite3.connect(":memory:")
        try:
            src.backup(oracle)
            oracle.execute("PRAGMA foreign_keys = ON")
            sql_text = "PRAGMA foreign_keys = ON;\n" + "\n".join(statements) + "\n"
            oracle.executescript("BEGIN;\n" + sql_text + "COMMIT;")
            if oracle.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("delta verification left foreign key violations")
            if planner.schema(oracle) != planner.schema(dst):
                raise ValueError("delta verification schema differs from target")
            if planner.rows_digest(oracle) != planner.rows_digest(dst):
                raise ValueError("delta verification logical rows differ from target")
            staging = load_module("multiday-staging")
            if not all(staging.compare_search(dst, oracle).values()):
                raise ValueError("delta verification search indexes differ from target")
        finally:
            oracle.close()

        out_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
        delta_sql_path = out_dir / "delta.sql"
        planner.private_write(delta_sql_path, sql_text)
        manifest = {
            "format": "workshop-d1-delta-v1",
            "from_sha256": planner.file_hash(from_path),
            "to_sha256": planner.file_hash(to_path),
            "delta_sql_sha256": hashlib.sha256(sql_text.encode("utf-8")).hexdigest(),
            "statement_count": len(statements),
            "bytes": len(sql_text.encode("utf-8")),
            "stats": stats,
        }
        planner.json_write(out_dir / "delta.json", manifest)
        return manifest
    finally:
        src.close()
        dst.close()


def configure(parser):
    parser.add_argument("--from-sqlite", type=Path, required=True)
    parser.add_argument("--to-sqlite", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)


def run(args):
    result = build_delta(args.from_sqlite, args.to_sqlite, args.output)
    print(json.dumps({"ok": True, **result}))
    return 0

"""Generate and self-verify incremental D1 SQL batches between two canonical SQLite snapshots."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sqlite3

HERE = Path(__file__).resolve().parent
STATEMENT_BYTES = 64_000
TEXT_CHUNK_BYTES = 30_000
BATCH_BYTES = 1_000_000
CHUNK_TABLE = "_workshop_delta_text_chunks"
WITHDRAWAL_FORMAT = "workshop-public-image-withdrawals-v1"
PUBLIC_KEY = re.compile(
    r"covers/(?:(?:gallery|banner)/)?[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}"
)

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


stage = load_module("d1-data")
taxonomy = load_module("taxonomy")


def sql_val(v):
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, bytes):
        return f"X'{v.hex()}'"
    if isinstance(v, str) and "\x00" not in v and "\r" not in v:
        return "'" + v.replace("'", "''") + "'"
    return stage.value(v)


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


def chunk_select_expr(field_index):
    return (
        f"(SELECT group_concat(piece, '') FROM (SELECT CAST(data AS TEXT) AS piece "
        f"FROM {quote(CHUNK_TABLE)} WHERE field = {field_index} ORDER BY part))"
    )


def chunk_setup_groups(selected_fields):
    groups = [[f"CREATE TABLE {quote(CHUNK_TABLE)} (field INTEGER NOT NULL, part INTEGER NOT NULL, data BLOB NOT NULL);"]]
    for field_index, text in selected_fields:
        data = text.encode("utf-8")
        for part, start in enumerate(range(0, len(data), TEXT_CHUNK_BYTES)):
            chunk_hex = data[start : start + TEXT_CHUNK_BYTES].hex()
            groups.append([f"INSERT INTO {quote(CHUNK_TABLE)} VALUES ({field_index}, {part}, X'{chunk_hex}');"])
    return groups


def emit_insert_groups(db, table, cols, row, all_tables):
    col_list = ",".join(quote(c) for c in cols)
    rendered = [sql_val(v) for v in row]
    stmt = f"INSERT INTO {quote(table)} ({col_list}) VALUES ({','.join(rendered)});"
    if len(stmt.encode("utf-8")) <= STATEMENT_BYTES:
        return [[stmt]]
    protected = stage.key_columns(db, table, all_tables)
    candidates = sorted(
        (i for i, col in enumerate(cols) if isinstance(row[i], str) and protected is not None and col not in protected),
        key=lambda i: len(rendered[i].encode("utf-8")),
        reverse=True,
    )
    selected = []
    for i in candidates:
        expr = chunk_select_expr(i)
        if len(expr.encode("utf-8")) >= len(rendered[i].encode("utf-8")):
            continue
        selected.append((i, row[i]))
        rendered[i] = expr
        stmt = f"INSERT INTO {quote(table)} ({col_list}) VALUES ({','.join(rendered)});"
        if len(stmt.encode("utf-8")) <= STATEMENT_BYTES:
            break
    if len(stmt.encode("utf-8")) > STATEMENT_BYTES:
        raise ValueError(f"oversized INSERT statement exceeds D1 limit in {table}")
    return [*chunk_setup_groups(selected), [stmt, f"DROP TABLE {quote(CHUNK_TABLE)};"]]


def emit_update_groups(db, table, cols, pks, key, row, all_tables):
    non_pk_indices = [i for i, c in enumerate(cols) if c not in pks]
    if not non_pk_indices:
        return []
    where_clause = where_pk(pks, key)
    rendered = {i: sql_val(row[i]) for i in non_pk_indices}
    assigns = ",".join(f"{quote(cols[i])} = {rendered[i]}" for i in non_pk_indices)
    stmt = f"UPDATE {quote(table)} SET {assigns} WHERE {where_clause};"
    if len(stmt.encode("utf-8")) <= STATEMENT_BYTES:
        return [[stmt]]
    protected = stage.key_columns(db, table, all_tables)
    candidates = sorted(
        (
            i
            for i in non_pk_indices
            if isinstance(row[i], str) and protected is not None and cols[i] not in protected
        ),
        key=lambda i: len(rendered[i].encode("utf-8")),
        reverse=True,
    )
    selected = []
    for i in candidates:
        expr = chunk_select_expr(i)
        if len(expr.encode("utf-8")) >= len(rendered[i].encode("utf-8")):
            continue
        selected.append((i, row[i]))
        rendered[i] = expr
        assigns = ",".join(f"{quote(cols[j])} = {rendered[j]}" for j in non_pk_indices)
        stmt = f"UPDATE {quote(table)} SET {assigns} WHERE {where_clause};"
        if len(stmt.encode("utf-8")) <= STATEMENT_BYTES:
            break
    if len(stmt.encode("utf-8")) > STATEMENT_BYTES:
        raise ValueError(f"oversized UPDATE statement exceeds D1 limit in {table}")
    return [*chunk_setup_groups(selected), [stmt, f"DROP TABLE {quote(CHUNK_TABLE)};"]]


def secondary_unique_slots(table, cols, row):
    idx = {c: i for i, c in enumerate(cols)}
    if table == "submissions":
        if row[idx["status"]] in ("pending", "checking"):
            return [("idx_submissions_one_pending", row[idx["project_id"]])]
        return []
    if table == "project_versions":
        return [("version_no", row[idx["project_id"]], row[idx["version_no"]])]
    if table == "assets":
        slots = []
        if row[idx["version_id"]] is not None:
            slots.append(("version_kind", row[idx["version_id"]], row[idx["kind"]]))
        else:
            slots.append(("display_kind", row[idx["project_id"]], row[idx["kind"]]))
        return slots
    if table == "recommendations":
        return [("curator_version", row[idx["curator_id"]], row[idx["project_version_id"]])]
    if table == "manual_reviews":
        return [("submission", row[idx["submission_id"]])]
    if table == "oauth_flows":
        return [("state_hash", row[idx["state_hash"]])]
    return []


def order_surviving_updates(table, cols, pks, old_rows, new_rows, changed_keys):
    """Order surviving-row updates so vacated secondary UNIQUE slots free before reuse, breaking swaps cleanly."""
    if not changed_keys:
        return [], changed_keys, set()
    slot_holders = {}
    for k in old_rows.keys() & new_rows.keys():
        for slot in secondary_unique_slots(table, cols, old_rows[k]):
            slot_holders[slot] = k
    # If A wants a slot currently held by surviving changed row B != A, B must update before A.
    deps = {k: set() for k in changed_keys}
    changed_set = set(changed_keys)
    for k in changed_keys:
        for slot in secondary_unique_slots(table, cols, new_rows[k]):
            holder = slot_holders.get(slot)
            if holder is not None and holder != k:
                if holder not in changed_set:
                    raise ValueError(f"secondary UNIQUE conflict with unchanged row in {table}")
                deps[k].add(holder)

    ordered = []
    deferred_victims = []
    remaining = set(changed_keys)
    prelim = []
    reinsert_keys = set()
    park_counter = 0
    while remaining:
        ready = sorted(k for k in remaining if not (deps[k] & remaining))
        if ready:
            for k in ready:
                ordered.append(k)
                remaining.remove(k)
            continue
        # Break cycle deterministically: park victim at a temporary value first,
        # let dependents vacate victim's target slot, then apply victim's final update.
        victim = min(remaining)
        park_counter += 1
        if table == "project_versions":
            prelim.append([f'UPDATE "project_versions" SET "version_no" = {-1_000_000_000 - park_counter} WHERE {where_pk(pks, victim)};'])
            remaining.remove(victim)
            deferred_victims.append(victim)
        elif table == "oauth_flows":
            temp_hash = sql_val(f"__delta_swap_{park_counter}_{victim[0]}")
            prelim.append([f'UPDATE "oauth_flows" SET "state_hash" = {temp_hash} WHERE {where_pk(pks, victim)};'])
            remaining.remove(victim)
            deferred_victims.append(victim)
        elif table in ("assets", "recommendations", "manual_reviews"):
            prelim.append([f"DELETE FROM {quote(table)} WHERE {where_pk(pks, victim)};"])
            remaining.remove(victim)
            reinsert_keys.add(victim)
        else:
            raise ValueError(f"unresolvable secondary UNIQUE update cycle in {table}")
    ordered.extend(deferred_victims)
    return prelim, ordered, reinsert_keys


def collect_public_object_keys(db):
    keys = set()
    for table in REPLICA_TABLES:
        for (obj_key,) in db.execute(f"SELECT object_key FROM {quote(table)}"):
            if not isinstance(obj_key, str) or not PUBLIC_KEY.fullmatch(obj_key):
                raise ValueError(f"invalid public replica object_key in {table}")
            keys.add(obj_key)
    return keys


def pack_batches(groups):
    header = "PRAGMA foreign_keys = ON;\n"
    header_bytes = len(header.encode("utf-8"))
    batches = []
    current = []
    current_bytes = header_bytes
    for group in groups:
        normalized = [s.rstrip().rstrip(";") + ";" for s in group if s.strip()]
        if not normalized:
            continue
        for stmt in normalized:
            if len(stmt.encode("utf-8")) > STATEMENT_BYTES:
                raise ValueError("delta SQL statement exceeds 64000-byte D1 limit")
        weight = sum(len(s.encode("utf-8")) + 1 for s in normalized)
        if header_bytes + weight > BATCH_BYTES:
            raise ValueError("indivisible delta SQL group exceeds 1000000-byte batch limit")
        if current and current_bytes + weight > BATCH_BYTES:
            batches.append((header + "\n".join(current) + "\n", list(current)))
            current = []
            current_bytes = header_bytes
        current.extend(normalized)
        current_bytes += weight
    if current:
        batches.append((header + "\n".join(current) + "\n", list(current)))
    return batches


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
        if len(ORDERED_BUSINESS_TABLES) != len(set(ORDERED_BUSINESS_TABLES)) or set(ORDERED_BUSINESS_TABLES) != taxonomy.logical_tables(dst):
            raise ValueError("ORDERED_BUSINESS_TABLES disagrees with canonical logical business tables")
        if set(REPLICA_TABLES) != taxonomy.PUBLIC_REPLICAS:
            raise ValueError("REPLICA_TABLES disagrees with canonical public replica tables")

        triggers = [(r["name"], r["sql"]) for r in planner.schema(dst) if r["type"] == "trigger"]
        search_trigger = dict(triggers).get("project_search_update")
        if not search_trigger:
            raise ValueError("missing project_search_update trigger")

        all_tables = set(ORDERED_BUSINESS_TABLES) | set(REPLICA_TABLES) | taxonomy.DERIVED
        withdrawn_public_objects = sorted(collect_public_object_keys(src) - collect_public_object_keys(dst))

        mutation_groups = []
        stats = {
            "inserted": 0,
            "updated": 0,
            "deleted": 0,
            "search_refreshed": 0,
            "withdrawn_public_objects": len(withdrawn_public_objects),
        }

        # 2. Withdraw changed/deleted public replicas BEFORE mutating projects/assets/site_settings
        for table in REPLICA_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            for key in sorted(old_rows.keys() - new_rows.keys()):
                mutation_groups.append([f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};"])
                stats["deleted"] += 1
            for key in sorted(old_rows.keys() & new_rows.keys()):
                if old_rows[key] != new_rows[key]:
                    mutation_groups.append([f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};"])

        # 3. Null out project pointers on projects being deleted or repointed before deleting versions/assets
        p_cols, p_pks = table_columns_and_pk(dst, "projects")
        old_projects = fetch_map(src, "projects", p_cols, p_pks)
        new_projects = fetch_map(dst, "projects", p_cols, p_pks)
        ptr_cols = ("working_version_id", "published_version_id", "published_cover_asset_id")
        ptr_idx = [p_cols.index(c) for c in ptr_cols]
        repointed_projects = []
        for key in sorted(old_projects.keys()):
            if key not in new_projects or any(old_projects[key][i] != new_projects[key][i] for i in ptr_idx):
                mutation_groups.append(
                    [f'UPDATE "projects" SET working_version_id=NULL, published_version_id=NULL, published_cover_asset_id=NULL WHERE {where_pk(p_pks, key)};']
                )
                if key in new_projects:
                    repointed_projects.append(key)

        # 4. Delete removed rows in reverse dependency order
        for table in reversed(ORDERED_BUSINESS_TABLES):
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            for key in sorted(old_rows.keys() - new_rows.keys()):
                mutation_groups.append([f"DELETE FROM {quote(table)} WHERE {where_pk(pks, key)};"])
                stats["deleted"] += 1
                if table == "projects":
                    pid = key[0]
                    mutation_groups.append([f"DELETE FROM project_search_tags WHERE project_id = {sql_val(pid)};"])

        # 5. Update surviving rows BEFORE inserting new rows in forward dependency order
        #    so vacated secondary/partial UNIQUE slots free before new inserts claim them.
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

        repointed_set = set(repointed_projects)
        for table in ORDERED_BUSINESS_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            changed_surviving = sorted(k for k in (old_rows.keys() & new_rows.keys()) if old_rows[k] != new_rows[k])
            prelim_groups, ordered_updates, reinsert_keys = order_surviving_updates(
                table, cols, pks, old_rows, new_rows, changed_surviving
            )
            mutation_groups.extend(prelim_groups)

            for key in ordered_updates:
                row = list(new_rows[key])
                if table == "projects":
                    if key in repointed_set:
                        for i in ptr_idx:
                            row[i] = None
                    changed_search_projects.add(key[0])
                elif table == "project_versions":
                    changed_search_projects.add(row[cols.index("project_id")])
                upd_groups = emit_update_groups(dst, table, cols, pks, key, row, all_tables)
                if upd_groups:
                    mutation_groups.extend(upd_groups)
                    stats["updated"] += 1

            for key in sorted(reinsert_keys):
                row = list(new_rows[key])
                mutation_groups.extend(emit_insert_groups(dst, table, cols, row, all_tables))
                stats["updated"] += 1

            for key in sorted(new_rows.keys() - old_rows.keys()):
                row = list(new_rows[key])
                if table == "projects":
                    for i in ptr_idx:
                        row[i] = None
                    repointed_projects.append(key)
                    repointed_set.add(key)
                    changed_search_projects.add(key[0])
                mutation_groups.extend(emit_insert_groups(dst, table, cols, row, all_tables))
                stats["inserted"] += 1

        # 6. Restore deferred project pointers
        for key in sorted(set(repointed_projects)):
            row = new_projects[key]
            assigns = ",".join(f"{quote(c)} = {sql_val(row[p_cols.index(c)])}" for c in ptr_cols)
            mutation_groups.append([f'UPDATE "projects" SET {assigns} WHERE {where_pk(p_pks, key)};'])
            changed_search_projects.add(key[0])

        # Refresh search for projects whose author display name changed or whose project was deleted
        if changed_authors:
            for pid, author_id in dst.execute("SELECT id, author_id FROM projects"):
                if author_id in changed_authors:
                    changed_search_projects.add(pid)
        deleted_project_ids = {k[0] for k in (old_projects.keys() - new_projects.keys())}
        if deleted_project_ids or changed_search_projects:
            mutation_groups.append(
                ["DELETE FROM project_search WHERE rowid NOT IN (SELECT rowid FROM projects WHERE published_version_id IS NOT NULL);"]
            )
            mutation_groups.append(
                ["DELETE FROM project_search_short WHERE rowid NOT IN (SELECT rowid FROM projects WHERE published_version_id IS NOT NULL);"]
            )
            for pid in sorted(changed_search_projects):
                mutation_groups.append(planner.canonical_search_statements(search_trigger, pid, set(p_cols)))
                stats["search_refreshed"] += 1

        # 7. Insert new/updated public image replicas
        for table in REPLICA_TABLES:
            cols, pks = table_columns_and_pk(dst, table)
            old_rows = fetch_map(src, table, cols, pks)
            new_rows = fetch_map(dst, table, cols, pks)
            for key in sorted(new_rows.keys()):
                if key not in old_rows or old_rows[key] != new_rows[key]:
                    mutation_groups.extend(emit_insert_groups(dst, table, cols, list(new_rows[key]), all_tables))
                    stats["inserted"] += 1

        groups = []
        if mutation_groups:
            # 1. Suspend triggers during deterministic state transition
            for name, _ in triggers:
                groups.append([f"DROP TRIGGER IF EXISTS {quote(name)};"])
            groups.extend(mutation_groups)
            # 8. Restore canonical triggers
            for _, trig_sql in triggers:
                groups.append([trig_sql.rstrip().rstrip(";") + ";"])

        packed = pack_batches(groups)
        all_statements = [stmt for _, stmts in packed for stmt in stmts]
        sql_text = (
            "PRAGMA foreign_keys = ON;\n" + "\n".join(all_statements) + ("\n" if all_statements else "")
        )

        # 9. Verify batch-by-batch in-memory against to_sqlite!
        oracle = sqlite3.connect(":memory:")
        try:
            src.backup(oracle)
            oracle.execute("PRAGMA foreign_keys = ON")
            for batch_text, _ in packed:
                oracle.executescript("BEGIN;\n" + batch_text + "COMMIT;")
                if oracle.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                    raise ValueError("delta batch disabled foreign key enforcement")
                if oracle.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise ValueError("delta batch left foreign key violations at batch boundary")
            if oracle.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise ValueError("delta verification left foreign key violations")
            if planner.schema(oracle) != planner.schema(dst):
                raise ValueError("delta verification schema differs from target")
            if planner.rows_digest(oracle) != planner.rows_digest(dst):
                raise ValueError("delta verification logical rows differ from target")
            staging = load_module("multiday-staging")
            if not all(staging.compare_search(dst, oracle).values()):
                raise ValueError("delta verification search indexes differ from target")
            for fts_table in ("project_search", "project_search_short"):
                oracle.execute(f"INSERT INTO {quote(fts_table)}({quote(fts_table)}) VALUES('integrity-check')")
        finally:
            oracle.close()

        from_sha = planner.file_hash(from_path)
        to_sha = planner.file_hash(to_path)
        out_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
        batches_dir = out_dir / "batches"
        batches_dir.mkdir(mode=0o700, parents=False, exist_ok=False)
        batch_entries = []
        for idx, (batch_text, batch_stmts) in enumerate(packed, 1):
            batch_id = f"{idx:06d}"
            batch_path = batches_dir / f"{batch_id}.sql"
            planner.private_write(batch_path, batch_text)
            batch_entries.append({
                "id": batch_id,
                "file": f"batches/{batch_id}.sql",
                "sha256": planner.file_hash(batch_path),
                "statement_count": len(batch_stmts),
                "bytes": len(batch_text.encode("utf-8")),
            })
        delta_sql_path = out_dir / "delta.sql"
        planner.private_write(delta_sql_path, sql_text)
        withdrawals_path = out_dir / "delta-withdrawals.json"
        planner.json_write(
            withdrawals_path,
            {
                "format": WITHDRAWAL_FORMAT,
                "from_sha256": from_sha,
                "to_sha256": to_sha,
                "objects": withdrawn_public_objects,
            },
        )
        manifest = {
            "format": "workshop-d1-delta-v1",
            "from_sha256": from_sha,
            "to_sha256": to_sha,
            "delta_sql_sha256": hashlib.sha256(sql_text.encode("utf-8")).hexdigest(),
            "statement_count": len(all_statements),
            "bytes": len(sql_text.encode("utf-8")),
            "batch_count": len(batch_entries),
            "batches": batch_entries,
            "withdrawn_public_objects": withdrawn_public_objects,
            "withdrawals_file": "delta-withdrawals.json",
            "withdrawals_sha256": planner.file_hash(withdrawals_path),
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

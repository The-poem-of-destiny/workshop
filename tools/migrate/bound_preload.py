"""Bound empty-database D1 preload runner with durable receipts and Free-tier budget cap."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid

HERE = Path(__file__).resolve().parent


def load_module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def resolve_credentials():
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    token = (
        os.environ.get("STAGING_IMPORT_TOKEN", "").strip()
        or os.environ.get("PRODUCTION_IMPORT_TOKEN", "").strip()
        or os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    )
    if not account or not token:
        raise ValueError("CLOUDFLARE_ACCOUNT_ID and import/API token are required")
    os.environ["STAGING_IMPORT_TOKEN"] = token
    return account, token


def realistic_batch_for_charge(batch, inventory_tables):
    phase = batch["phase"]
    rows = batch.get("data_rows", 0)
    if phase.startswith("data:"):
        table = phase[5:]
        indexes = len(inventory_tables.get(table, {}).get("indexes", []))
        est = max(1, rows * (1 + indexes))
        return dict(batch, estimated_rows_written=est, realistic_rows_written=est)
    if phase == "restore-project-pointers":
        est = max(1, rows * 2)
        return dict(batch, estimated_rows_written=est, realistic_rows_written=est)
    if phase == "search":
        est = max(128, rows * 4)
        return dict(batch, estimated_rows_written=est, realistic_rows_written=est)
    return batch


def capture_bookmark(cloud, database, out_path):
    if out_path.exists():
        saved = json.loads(out_path.read_text(encoding="utf-8"))
        if saved.get("database_id") == database and isinstance(saved.get("bookmark"), str) and saved["bookmark"]:
            return saved
        raise ValueError("existing recovery bookmark does not match bound preload database")
    result = cloud.request(f"/{database}/time_travel/bookmark")
    bookmark = result.get("bookmark") if isinstance(result, dict) else None
    if not isinstance(bookmark, str) or not bookmark:
        raise ValueError("could not capture D1 Time Travel recovery bookmark")
    record = {"database_id": database, "bookmark": bookmark}
    fd = os.open(out_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
        f.write("\n")
    return record


def finish_replicas(staging, journal, pending, result):
    actual = result.get("statistics", {}).get("rows_written")
    if (
        result.get("outcome") != "complete"
        or result.get("ok") is not True
        or isinstance(actual, bool)
        or not isinstance(actual, int)
        or actual < 0
    ):
        journal.record("replicas-failed", result, phase="failed", pending_replicas=None, failure="replicas_import_failed")
        raise staging.imp.ImportFailure("replicas import failed; inspect journal")
    ledger = {day: dict(value) for day, value in journal.state["ledger"].items()}
    staging.budget.settle(ledger, pending["day"], pending["reserved"], actual)
    exceeded = actual > pending["reserved"]
    journal.record(
        "replicas-reservation-exceeded" if exceeded else "replicas-loaded",
        result,
        phase="failed" if exceeded else "replicas_loaded",
        ledger=ledger,
        pending_replicas=None,
        replicas_sha256=None if exceeded else pending["sha256"],
        failure="actual_writes_exceeded_reservation" if exceeded else None,
    )
    if exceeded:
        raise staging.imp.ImportFailure("actual writes exceeded reservation; no further writes authorized")


def resume_pending_replicas(staging, journal, replicas_sql):
    pending = journal.state.get("pending_replicas")
    if not pending:
        return
    if replicas_sql is not None:
        if not replicas_sql.is_file() or staging.digest(replicas_sql) != pending.get("sha256"):
            raise staging.imp.ImportFailure("supplied --replicas-sql differs from pending replicas operation")
    receipts = Path(pending["receipts"])
    unstarted = not receipts.exists() or not list(receipts.glob("[0-9]*-*.json"))
    has_bookmark = False
    if unstarted:
        if receipts.exists():
            staging.imp.check_private(receipts, directory=True)
            for path in receipts.iterdir():
                staging.imp.check_private(path)
                if path.name not in (".lock", "input.sql") and not path.name.startswith(".receipt-"):
                    raise staging.imp.ImportFailure("missing numbered replicas receipts with unexplained local evidence")
    else:
        saved = staging.imp.Journal(receipts, journal.token)
        try:
            if (
                saved.state.get("file", {}).get("sha256") != pending["sha256"]
                or saved.state.get("database_id") != journal.state["candidate_database_id"]
                or saved.state.get("candidate_name") != journal.state["candidate_name"]
            ):
                raise staging.imp.ImportFailure("saved replicas import differs from frozen SQL or target database")
            has_bookmark = bool(saved.state.get("at_bookmark")) or saved.state.get("outcome") in ("complete", "error")
            unstarted = (
                saved.state.get("phase")
                in {"prepared", "target_requested", "target_received", "target_unknown", "target_validated"}
                and not saved.state.get("at_bookmark")
                and not saved.state.get("outcome")
            )
        finally:
            saved.close()
    if unstarted:
        ledger = {day: dict(value) for day, value in journal.state["ledger"].items()}
        ledger[pending["day"]]["charged"] -= pending["reserved"]
        if ledger[pending["day"]]["charged"] < 0:
            raise staging.imp.ImportFailure("unstarted replicas reservation does not match durable ledger")
        attempts = dict(journal.state.get("attempts", {}))
        attempts["replicas"] = attempts.get("replicas", 0) + 1
        journal.record(
            "replicas-proven-unstarted",
            phase="verified",
            pending_replicas=None,
            ledger=ledger,
            attempts=attempts,
            failure=None,
        )
        return
    if not has_bookmark:
        journal.record(
            "replicas-failed",
            {"receipts": str(receipts)},
            phase="failed",
            pending_replicas=None,
            failure="replicas_import_unrecoverable_missing_bookmark",
        )
        raise staging.imp.ImportFailure("no saved actual at_bookmark for replicas import; never resubmit ingest")
    result = staging.imp.saved_status(receipts, resume=True)
    finish_replicas(staging, journal, pending, result)


def verify_empty_bound_schema(staging_mod, cloud, database, name, plan, inventory):
    cloud.identity(database, name)
    catalog = cloud.query(
        database,
        "SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
    )
    normalize = lambda rows: {(r["type"], r["name"], " ".join(r["sql"].split())) for r in rows}
    actual = normalize(r for r in catalog if not r["name"].startswith("_cf_") and r["name"] != "d1_migrations")
    expected = normalize(plan["schema"])
    if actual != expected:
        raise ValueError("bound target D1 schema differs from sealed plan schema")
    tables = [t for t in inventory["tables"] if not t.startswith("project_search_") or t == "project_search_tags"]
    query = "SELECT " + ",".join(
        f"(SELECT count(*) FROM {staging_mod.imp_quote(t)}) AS {staging_mod.imp_quote(t)}" for t in tables
    )
    counts, = cloud.query(database, query)
    if any(counts.values()):
        raise ValueError("bound target D1 is not empty; use delta or inspect existing rows")


def configure(parser):
    parser.add_argument("preload_mode", choices=("advance", "verify", "status", "replicas"))
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--database-id", required=True)
    parser.add_argument("--database-name", required=True)
    parser.add_argument("--max-batches", type=int, default=150)
    parser.add_argument("--daily-write-cap", type=int, default=95_000)
    parser.add_argument("--replicas-sql", type=Path, help="verified replicas SQL from public-images finalize")
    parser.add_argument("--confirm-target", action="store_true")


def run(args):
    if not 1 <= args.max_batches <= 300:
        raise SystemExit("--max-batches must be between 1 and 300")
    if not 1_000 <= args.daily_write_cap <= 100_000:
        raise SystemExit("--daily-write-cap must be between 1000 and 100000")
    if str(uuid.UUID(args.database_id)) != args.database_id:
        raise SystemExit("invalid --database-id UUID")
    os.umask(0o077)
    account, token = resolve_credentials()
    staging = load_module("multiday-staging")
    staging.budget.ACCOUNT_WRITE_CEILING = args.daily_write_cap

    def bound_validate_identity(database_id, result, candidate_name=None):
        ok = (
            database_id == args.database_id
            and (candidate_name is None or candidate_name == args.database_name)
            and isinstance(result, dict)
            and result.get("uuid") == args.database_id
            and result.get("name") == args.database_name
        )
        if not ok:
            raise staging.imp.ImportFailure("database does not match the exact bound preload target")

    def bound_candidate(journal, cloud, _plan):
        if journal.state["candidate_database_id"] != args.database_id or journal.state["candidate_name"] != args.database_name:
            raise ValueError("journal target differs from bound database arguments")
        cloud.identity(args.database_id, args.database_name)
        return args.database_id

    staging.imp.validate_identity = bound_validate_identity
    staging.candidate = bound_candidate
    plan_path = args.plan.resolve()
    base_plan = staging.checked_plan(plan_path)
    if not base_plan["batches"] or base_plan["batches"][0]["phase"] != "initialize:0001_initial.sql":
        raise ValueError("expected batch 0 to be initialize:0001_initial.sql")
    plan = dict(base_plan, candidate_name=args.database_name)
    inventory = json.loads((plan_path.parent / "inventory.json").read_text(encoding="utf-8"))

    journal = None
    try:
        if args.preload_mode != "status" and not args.confirm_target:
            raise ValueError("explicit --confirm-target required")
        journal = staging.open_journal(args.state_dir, plan_path, plan, account, token)
        cloud = staging.Cloud(account, token, journal)
        if args.preload_mode == "status":
            print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
            return 0
        if journal.state.get("phase") == "failed" and not journal.state.get("pending") and not journal.state.get("pending_replicas"):
            raise staging.imp.ImportFailure("preload execution is failed; preserve evidence and investigate")
        if journal.state["next_batch"] == 0:
            verify_empty_bound_schema(staging, cloud, args.database_id, args.database_name, plan, inventory)
            bookmark_path = journal.directory / "recovery-bookmark.json"
            capture_bookmark(cloud, args.database_id, bookmark_path)
            journal.record(
                "bound-schema-verified",
                candidate_database_id=args.database_id,
                next_batch=1,
                phase="loading",
                recovery_sha256=hashlib.sha256(bookmark_path.read_bytes()).hexdigest(),
            )
        if args.preload_mode == "replicas":
            if journal.state.get("phase") not in ("verified", "replicas_unknown", "replicas_loaded"):
                raise ValueError("base D1 snapshot must be verified before loading public image replicas")
            if journal.state.get("pending_replicas") is not None or journal.state.get("phase") == "replicas_unknown":
                if not journal.state.get("pending_replicas"):
                    journal.record("replicas-failed", phase="failed", failure="replicas_unknown_without_pending_record")
                    raise staging.imp.ImportFailure("replicas_unknown state has no pending_replicas record")
                resume_pending_replicas(staging, journal, args.replicas_sql)
            if journal.state.get("phase") == "replicas_loaded":
                if args.replicas_sql and args.replicas_sql.is_file():
                    if journal.state.get("replicas_sha256") not in (None, staging.digest(args.replicas_sql)):
                        raise ValueError("loaded replicas_sha256 differs from supplied --replicas-sql")
                print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
                return 0
            if not args.replicas_sql or not args.replicas_sql.is_file():
                raise ValueError("--replicas-sql file is required for replicas mode")
            sql_sha = staging.digest(args.replicas_sql)
            stmt_rows = sum(1 for line in args.replicas_sql.read_text("utf-8").splitlines() if line.startswith("INSERT "))
            charge = max(128, stmt_rows * 3)
            if not staging.allowance(journal, account, token, charge):
                print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
                return 75
            ledger = dict(journal.state["ledger"])
            day = staging.budget.reserve(ledger, charge)
            attempt = journal.state.get("attempts", {}).get("replicas", 0)
            suffix = "" if attempt == 0 else f"-attempt-{attempt:03d}"
            receipts_dir = str(journal.directory / f"replicas-import{suffix}")
            pending = {"id": "replicas", "sha256": sql_sha, "day": day, "reserved": charge, "receipts": receipts_dir}
            journal.record("replicas-requested", phase="replicas_unknown", ledger=ledger, pending_replicas=pending)
            result = staging.imp.execute(args.database_id, args.replicas_sql, receipts_dir, candidate_name=args.database_name)
            finish_replicas(staging, journal, pending, result)
            print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
            return 0
        if journal.state.get("pending_replicas") is not None or journal.state.get("phase") == "replicas_unknown":
            raise ValueError("pending public image replicas import must be resolved via preload replicas first")
        if args.preload_mode == "verify":
            ready = staging.verify(journal, cloud, plan_path, plan)
            print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
            return 0 if ready else 75

        # Advance mode with realistic initial write reservation
        staging.resume_pending(journal, plan)
        for _ in range(args.max_batches):
            index = journal.state["next_batch"]
            if index == len(plan["batches"]):
                journal.record("loaded", phase="loaded", next_attempt_at=None)
                ready = staging.verify(journal, cloud, plan_path, plan)
                print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
                return 0 if ready else 75
            batch = plan["batches"][index]
            charge_batch = realistic_batch_for_charge(batch, inventory["tables"])
            charge = staging.budget.charge_for(charge_batch, journal.state.get("cost_history", {}))
            if not staging.allowance(journal, account, token, charge):
                print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
                return 75
            ledger = dict(journal.state["ledger"])
            day = staging.budget.reserve(ledger, charge)
            sql = plan_path.parent / batch["file"]
            if staging.digest(sql) != batch["sha256"]:
                raise ValueError("SQL changed after plan verification")
            attempt = journal.state.get("attempts", {}).get(str(index), 0)
            pending = {
                "index": index,
                "id": batch["id"],
                "sha256": batch["sha256"],
                "day": day,
                "reserved": charge,
                "receipts": str(journal.directory / f"batch-{index:05d}-attempt-{attempt:03d}"),
            }
            journal.record("batch-requested", phase="batch_unknown", ledger=ledger, pending=pending)
            result = staging.imp.execute(args.database_id, sql, pending["receipts"], candidate_name=args.database_name)
            staging.finish_batch(journal, pending, result, plan)
        print(json.dumps(staging.public_status(journal.state), ensure_ascii=True))
        return 75
    except (ValueError, RuntimeError, OSError, KeyError, sqlite3.Error) as error:
        print("bound-preload: " + staging.imp.sanitize_text(str(error), token), file=sys.stderr)
        return 1
    finally:
        if journal is not None:
            journal.close()

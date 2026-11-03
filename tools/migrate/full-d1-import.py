#!/usr/bin/env python3
"""Import SQL into staging D1 with private, durable receipts; never retry ingest.

Protocol: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/import/
Target check: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
from http.client import HTTPException
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[2]
STAGING_DATABASE = "7500b5f6-21a0-4dfd-9e16-0d9a4f9de476"
PROBE_NAME = "workshop-staging-import-rehearsal"
API = "https://api.cloudflare.com/client/v4"


class ImportFailure(RuntimeError):
    """Public error text must not contain remote SQL, credentials, or URLs."""


def sanitize_text(text, token=None):
    token = os.environ.get("STAGING_IMPORT_TOKEN", "") if token is None else token
    if token:
        text = text.replace(token, "[REDACTED_TOKEN]")
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"(?i)\bBearer\s+[^\s\"'<>]+", "Bearer [REDACTED_TOKEN]", text)
    text = re.sub(r"(?i)\b((?:STAGING_IMPORT_TOKEN|CLOUDFLARE_API_TOKEN|authorization)\s*[:=]\s*)[^\s,;]+",
                  r"\1[REDACTED_TOKEN]", text)
    return re.sub(r"(?i)https?://[^\s\"'<>]+", "[REDACTED_URL]", text)


def sanitize(value, token):
    if isinstance(value, str):
        return sanitize_text(value, token)
    if isinstance(value, list):
        return [sanitize(item, token) for item in value]
    if isinstance(value, dict):
        return {sanitize_text(str(key), token):
                ("[REDACTED_URL]" if str(key).lower() == "upload_url" else sanitize(item, token))
                for key, item in value.items()}
    return value


def outside_repository(path):
    path = Path(path).resolve()
    if path == ROOT or ROOT in path.parents:
        raise ValueError("artifacts must be outside the repository")
    return path


def check_private(path, directory=False):
    info = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("artifacts must be owned by this user and private (directory 0700, files 0600)")


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_json(path, value, replace=False):
    fd, temporary = tempfile.mkstemp(prefix=".receipt-", dir=path.parent)
    temporary = Path(temporary)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            json.dump(value, out, ensure_ascii=True, indent=2, allow_nan=False)
            out.write("\n")
            out.flush()
            os.fsync(out.fileno())
        if replace:
            os.replace(temporary, path)
        else:
            os.link(temporary, path)
            temporary.unlink()
        sync_directory(path.parent)
    finally:
        temporary.unlink(missing_ok=True)


class Journal:
    def __init__(self, directory, token, create=False):
        self.directory = outside_repository(directory)
        self.token = token
        self.state = {}
        self.sequence = 0
        if create:
            self.directory.mkdir(mode=0o700, parents=False, exist_ok=False)
            sync_directory(self.directory.parent)
        check_private(self.directory, directory=True)
        fd = os.open(self.directory / ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        self.lock = os.fdopen(fd, "a+")
        try:
            check_private(self.directory / ".lock")
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if not create:
                receipts = sorted(self.directory.glob("[0-9]*-*.json"))
                if not receipts:
                    raise ValueError("no durable import receipts found")
                latest = receipts[-1]
                check_private(latest)
                saved = json.loads(latest.read_text(encoding="utf-8"))
                self.state = saved["state"]
                self.sequence = saved["sequence"]
                if (self.state.get("version") != 1 or not isinstance(self.sequence, int)
                        or not latest.name.startswith(f"{self.sequence:08d}-")):
                    raise ValueError("invalid import receipt")
        except BaseException:
            self.lock.close()
            raise

    def close(self):
        self.lock.close()

    def record(self, event, details=None, **updates):
        sequence = self.sequence + 1
        name = f"{sequence:08d}-{event}.json"
        state = dict(self.state, **updates)
        if updates.get("outcome") in ("complete", "error"):
            state["final_receipt"] = name
        receipt = sanitize({"sequence": sequence, "event": event,
                            "recorded_at": datetime.now(timezone.utc).isoformat(),
                            "state": state, "details": details}, self.token)
        atomic_json(self.directory / name, receipt)
        self.sequence = sequence
        self.state = receipt["state"]
        # Receipts are authoritative if interrupted between these two durable writes.
        atomic_json(self.directory / "state.json", self.state, replace=True)

    def summary(self):
        state = self.state
        return {"ok": state.get("outcome") == "complete", "phase": state.get("phase"),
                "outcome": state.get("outcome", "pending"),
                "database_id": state.get("database_id"), "database_name": state.get("database_name"),
                "file": state.get("file"), "poll_available": bool(state.get("at_bookmark")),
                "artifacts": str(self.directory), "final_receipt": state.get("final_receipt"),
                "http_status": state.get("http_status"), "api_error_codes": state.get("api_error_codes", []),
                "statistics": state.get("statistics", {})}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Client:
    def __init__(self, journal, account, database, token):
        if not re.fullmatch(r"[0-9a-fA-F]{32}", account):
            raise ValueError("invalid Cloudflare account ID")
        try:
            if str(uuid.UUID(database)) != database:
                raise ValueError()
        except (ValueError, AttributeError):
            raise ValueError("invalid D1 database ID") from None
        self.journal = journal
        self.token = token
        self.url = f"{API}/accounts/{account}/d1/database/{database}"
        self.opener = build_opener(NoRedirect())

    def api(self, action=None):
        journal = self.journal
        phase = action["action"] if action else "target"
        journal.record(phase + "-requested", phase=phase + "_requested")
        request = Request(self.url + ("/import" if action else ""),
                          data=json.dumps(action).encode() if action else None,
                          method="POST" if action else "GET", headers={
                              "Authorization": "Bearer " + self.token,
                              "Content-Type": "application/json"})
        try:
            try:
                response = self.opener.open(request, timeout=120)
            except HTTPError as exc:
                response = exc
            with response:
                status = response.code
                ray = response.headers.get("CF-Ray")
                body = response.read()
            try:
                payload = json.loads(body)
            except (ValueError, UnicodeError):
                payload = {"unparsed_response": body.decode("utf-8", errors="replace")}
        except (URLError, OSError, HTTPException) as exc:
            journal.record(phase + "-transport-error",
                           {"exception": type(exc).__name__, "message": str(exc)},
                           phase=phase + "_unknown")
            raise ImportFailure(f"D1 {phase} outcome unknown; inspect private receipts; never resubmit ingest") from None
        result = payload.get("result") if isinstance(payload, dict) else None
        errors = payload.get("errors") if isinstance(payload, dict) else None
        codes = [item["code"] for item in errors
                 if isinstance(item, dict) and isinstance(item.get("code"), (int, float))] if isinstance(errors, list) else []
        updates = {"phase": phase + "_received", "http_status": status, "api_error_codes": codes}
        valid = (200 <= status < 300 and isinstance(payload, dict)
                 and payload.get("success") is True and isinstance(result, dict))
        if phase != "target" and isinstance(result, dict):
            actual_bookmark = result.get("at_bookmark")
            if isinstance(actual_bookmark, str) and actual_bookmark:
                previous = journal.state.get("at_bookmark")
                if previous and previous != actual_bookmark:
                    valid = False
                    updates["phase"] = phase + "_bookmark_mismatch"
                else:
                    updates["at_bookmark"] = actual_bookmark
            if valid and result.get("status") in ("complete", "error"):
                updates["outcome"] = result["status"]
                if result.get("success") is False:
                    updates["outcome"] = "error"
                updates["phase"] = updates["outcome"]
                statistics = result.get("result", {})
                meta = statistics.get("meta", {}) if isinstance(statistics, dict) else {}
                if not isinstance(meta, dict):
                    meta = {}
                updates["statistics"] = {
                    key: value for key, value in meta.items()
                    if key in ("changes", "duration", "rows_read", "rows_written", "size_after", "changed_db")
                    and isinstance(value, (int, float, bool))}
                if isinstance(statistics, dict) and isinstance(statistics.get("num_queries"), (int, float)):
                    updates["statistics"]["num_queries"] = statistics["num_queries"]
        journal.record(phase + "-response", {"http_status": status, "cf_ray": ray, "response": payload}, **updates)
        if not valid:
            raise ImportFailure(f"D1 {phase} response rejected (HTTP {status}, API codes {codes}); inspect private receipts")
        if phase != "target" and result.get("success") is False and result.get("status") not in ("complete", "error"):
            raise ImportFailure(f"D1 {phase} reported failure; inspect private receipts; never resubmit ingest")
        return result

    def validate_target(self):
        result = self.api()
        database = self.journal.state["database_id"]
        try:
            validate_identity(database, result, self.journal.state.get("candidate_name"))
        except ImportFailure:
            self.journal.record("target-rejected", phase="target_rejected")
            raise
        self.journal.record("target-validated", phase="target_validated", database_name=result.get("name"))

    def upload(self, url, path):
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise ImportFailure("invalid D1 upload URL; inspect private init receipt")
        journal = self.journal
        journal.record("upload-requested", phase="upload_requested")
        try:
            with path.open("rb") as source:
                request = Request(url, data=source, method="PUT",
                                  headers={"Content-Length": str(journal.state["file"]["bytes"])})
                try:
                    response = self.opener.open(request, timeout=300)
                except HTTPError as exc:
                    response = exc
                with response:
                    status = response.code
                    etag = response.headers.get("ETag", "").strip('"')
                    body = response.read().decode("utf-8", errors="replace")
        except (URLError, OSError, HTTPException) as exc:
            journal.record("upload-transport-error", {"exception": type(exc).__name__, "message": str(exc)},
                           phase="upload_unknown")
            raise ImportFailure("D1 upload outcome unknown; ingest was not submitted; inspect private receipts") from None
        journal.record("upload-response", {"http_status": status, "etag": etag, "body": body}, phase="upload_received")
        if status != 200 or etag.lower() != journal.state["file"]["md5"]:
            raise ImportFailure("D1 upload status or MD5 ETag mismatch; ingest was not submitted; inspect private receipts")


def credentials():
    token = os.environ.get("STAGING_IMPORT_TOKEN")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if not token or not account:
        raise ValueError("STAGING_IMPORT_TOKEN and CLOUDFLARE_ACCOUNT_ID are required; no ambient credential fallback")
    return account, token


def seal_file(source, directory):
    md5 = hashlib.md5(usedforsecurity=False)
    sha256 = hashlib.sha256()
    size = 0
    with Path(source).open("rb") as incoming:
        fd = os.open(directory / "input.sql", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as outgoing:
            while chunk := incoming.read(1024 * 1024):
                md5.update(chunk)
                sha256.update(chunk)
                size += len(chunk)
                outgoing.write(chunk)
            outgoing.flush()
            os.fsync(outgoing.fileno())
    sync_directory(directory)
    if not size:
        raise ValueError("SQL file must not be empty")
    return {"bytes": size, "md5": md5.hexdigest(), "sha256": sha256.hexdigest()}


def poll(client, once=False, interval=2.0):
    journal = client.journal
    while journal.state.get("outcome") not in ("complete", "error"):
        bookmark = journal.state.get("at_bookmark")
        if not isinstance(bookmark, str) or not bookmark:
            raise ImportFailure("no saved actual at_bookmark; polling cannot identify this import; never resubmit ingest")
        client.api({"action": "poll", "current_bookmark": bookmark})
        if once:
            break
        if journal.state.get("outcome") not in ("complete", "error"):
            time.sleep(interval)
    return journal.summary()


def execute(database_id, file, artifacts, candidate_name=None):
    """Start a new import exactly once and poll; failures retain private evidence."""
    account, token = credentials()
    journal = Journal(artifacts, token, create=True)
    try:
        client = Client(journal, account, database_id, token)
        journal.record("prepared", version=1, account_id=account, database_id=database_id, phase="prepared",
                       candidate_name=candidate_name, file=seal_file(file, journal.directory))
        client.validate_target()
        result = client.api({"action": "init", "etag": journal.state["file"]["md5"]})
        if "upload_url" in result:
            if journal.state.get("at_bookmark") or result.get("status") in ("complete", "error"):
                raise ImportFailure("unexpected init upload and import state; inspect receipts; never resubmit ingest")
            filename = result.get("filename")
            if not isinstance(filename, str) or not filename or not isinstance(result["upload_url"], str):
                raise ImportFailure("init did not provide a usable upload filename and URL")
            client.upload(result["upload_url"], journal.directory / "input.sql")
            client.api({"action": "ingest", "filename": filename, "etag": journal.state["file"]["md5"]})
        # A cached init may already start ingestion: never issue a second ingest.
        return poll(client)
    finally:
        journal.close()


def saved_status(artifacts, resume=False):
    """Poll once (status) or until terminal (resume), using only the saved bookmark."""
    account, token = credentials()
    journal = Journal(artifacts, token)
    try:
        if journal.state.get("account_id") != account:
            raise ValueError("credential account does not match the saved import")
        if journal.state.get("outcome") in ("complete", "error"):
            return journal.summary()
        if not journal.state.get("at_bookmark"):
            raise ImportFailure("no saved actual at_bookmark; outcome needs manual investigation; never resubmit ingest")
        client = Client(journal, account, journal.state["database_id"], token)
        client.validate_target()
        return poll(client, once=not resume)
    finally:
        journal.close()


def validate_identity(database_id, result, candidate_name=None):
    if candidate_name is not None:
        allowed = (isinstance(candidate_name, str)
                   and re.fullmatch(r"workshop-staging-migrate-[0-9a-f]{12}", candidate_name)
                   and isinstance(result, dict) and result.get("name") == candidate_name
                   and database_id != STAGING_DATABASE)
    else:
        allowed = (isinstance(result, dict)
                   and (database_id == STAGING_DATABASE or result.get("name") == PROBE_NAME))
    if not allowed or not isinstance(result, dict) or result.get("uuid") != database_id:
        raise ImportFailure("database is not the exact authorized staging, rehearsal or plan-bound candidate target")


def validate_target(database_id, candidate_name=None):
    """Read-only live identity check for the exact authorized target."""
    account, token = credentials()
    if not re.fullmatch(r"[0-9a-fA-F]{32}", account) or str(uuid.UUID(database_id)) != database_id:
        raise ValueError("invalid Cloudflare account or D1 database ID")
    request = Request(f"{API}/accounts/{account}/d1/database/{database_id}",
                      headers={"Authorization": "Bearer " + token})
    try:
        with build_opener(NoRedirect()).open(request, timeout=60) as response:
            payload = json.load(response)
    except (URLError, OSError, HTTPException, ValueError):
        raise ImportFailure("could not verify D1 target identity") from None
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise ImportFailure("D1 target identity response was rejected")
    validate_identity(database_id, result, candidate_name)
    return {"uuid": result["uuid"], "name": result.get("name")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    start = commands.add_parser("execute", help="start once using a new private artifacts directory")
    start.add_argument("--database-id", required=True)
    start.add_argument("--candidate-name", required=True)
    start.add_argument("--file", type=Path, required=True)
    start.add_argument("--artifacts", type=Path, required=True)
    for name in ("status", "resume"):
        sub = commands.add_parser(name, help="poll using the saved actual at_bookmark; never submit ingest")
        sub.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        result = (execute(args.database_id, args.file, args.artifacts, candidate_name=args.candidate_name)
                  if args.command == "execute" else saved_status(args.artifacts, resume=args.command == "resume"))
        print(json.dumps(result, ensure_ascii=True, indent=2))
        return 1 if result["outcome"] == "error" else 0
    except KeyboardInterrupt:
        error = "interrupted; keep writers stopped and use status/resume only; never resubmit ingest"
    except (ImportFailure, OSError, ValueError, TypeError, KeyError) as exc:
        # Only our fixed exception text is public; OS/path/parser errors may carry private input.
        error = str(exc) if isinstance(exc, ImportFailure) else "local configuration or artifact error; inspect private artifacts"
    print(json.dumps({"ok": False, "error": error}, ensure_ascii=True), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())

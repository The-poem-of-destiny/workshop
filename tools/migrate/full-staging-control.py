#!/usr/bin/env python3
"""Control staging admission and check migrated public reads without business writes."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
import re
from pathlib import Path
import stat
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener

ORIGIN = "https://workshop-staging.poem-of-destiny.workers.dev"
MAINTENANCE = "/api/v1/maintenance"
MAX_JSON_BYTES = 16 * 1024 * 1024


class ControlError(Exception):
    """Only fixed, non-sensitive diagnostic labels reach the console."""


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def require(condition, label):
    if not condition:
        raise ControlError(label)


def read_token(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as source:
        info = os.fstat(source.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                and stat.S_IMODE(info.st_mode) & 0o077 == 0,
                "token_file_requires_owned_private_regular_file")
        raw = source.read(4097)
    require(0 < len(raw) <= 4096, "invalid_token_file")
    raw = raw.rstrip(b"\r\n")
    require(raw and all(33 <= value <= 126 for value in raw), "invalid_token_file")
    return raw.decode("ascii")


class Staging:
    def __init__(self, token, timeout):
        self.token = token
        self.timeout = timeout
        # HTTPS may use the machine proxy; redirects and ambient sessions remain disabled.
        self.opener = build_opener(NoRedirect())
        self.counts = Counter()

    def request(self, path, *, action=None, operator=False, limit=MAX_JSON_BYTES):
        require(path.startswith("/api/v1/") and not path.startswith("//")
                and "#" not in path, "invalid_request_path")
        require(not operator or path == MAINTENANCE, "invalid_operator_target")
        require(action is None or (operator and action in ("close", "open")), "invalid_action")
        headers = {"accept": "application/json", "user-agent": "workshop-staging-control/1.0"}
        if operator:
            headers["authorization"] = "Bearer " + self.token
        data = None
        if action is not None:
            headers["content-type"] = "application/json"
            data = json.dumps({"action": action}).encode("ascii")
        request = Request(ORIGIN + path, data=data, headers=headers,
                          method="POST" if action is not None else "GET")
        try:
            response = self.opener.open(request, timeout=self.timeout)
        except HTTPError as exc:
            response = exc
        except (URLError, TimeoutError, OSError):
            raise ControlError("staging_request_failed") from None
        try:
            with response:
                status = response.code
                body = response.read(limit + 1)
                headers = response.headers
        except (URLError, TimeoutError, OSError):
            raise ControlError("staging_response_failed") from None
        require(len(body) <= limit, "response_exceeds_expected_size")
        self.counts["requests"] += 1
        self.counts["http_" + str(status)] += 1
        return status, headers, body

    def json(self, path, *, expected=200, code=None, action=None, operator=False):
        status, headers, body = self.request(path, action=action, operator=operator)
        require(status == expected, "unexpected_http_status_" + str(status)
                + "_request_" + str(self.counts["requests"]))
        require("application/json" in headers.get("content-type", "").lower(), "expected_json_response")
        try:
            payload = json.loads(body)
        except (ValueError, UnicodeError):
            raise ControlError("invalid_json_response") from None
        require(isinstance(payload, dict), "expected_json_object")
        if code is not None:
            require(isinstance(payload.get("error"), dict) and payload["error"].get("code") == code,
                    "unexpected_rejection_code")
            require("no-store" in headers.get("cache-control", ""), "rejection_must_not_be_cached")
        return payload

    def maintenance(self, action=None):
        result = self.json(MAINTENANCE, operator=True, action=action)
        require(type(result.get("closed")) is bool and type(result.get("drained")) is bool
                and isinstance(result.get("outstanding"), list)
                and type(result.get("outstandingTruncated")) is bool, "invalid_maintenance_status")
        outstanding = len(result["outstanding"])
        require(result["drained"] == (result["closed"] and outstanding == 0)
                and (not result["outstandingTruncated"] or outstanding == 100),
                "inconsistent_maintenance_status")
        if action == "close":
            require(result["closed"], "maintenance_close_not_confirmed")
        if action == "open":
            require(not result["closed"] and outstanding == 0, "maintenance_open_not_confirmed")
        return {"closed": result["closed"], "drained": result["drained"],
                "outstanding_count": outstanding, "outstanding_truncated": result["outstandingTruncated"]}


def public(project):
    return (project.get("visibility") == "public" and project.get("published_revision_id") is not None
            and project.get("deleted_at") is None)


def segment(value):
    return quote(str(value), safe="")


def entries_for(preparation, revision_id):
    rows = preparation["tables"]["revision_entry_index"]
    return [{"kind": row["kind"], "entryKey": row["entry_key"], "name": row["name"],
             "contentHash": row["content_hash"], "contentLength": row["content_length"]}
            for row in sorted((row for row in rows if row["revision_id"] == revision_id),
                              key=lambda row: (row["kind"], row["entry_key"]))]


def check_summary(item, projects, revisions):
    require(isinstance(item, dict) and item.get("id") in projects, "unexpected_public_project")
    project = projects[item["id"]]
    revision = revisions[project["published_revision_id"]]
    require(item.get("visibility") == "public" and item.get("title") == project["title"]
            and item.get("publishedRevisionId") == revision["id"]
            and item.get("entries") == {"worldbook": revision["worldbook_count"], "regex": revision["regex_count"]},
            "public_project_snapshot_mismatch")


def check_items(payload, projects, revisions):
    require(isinstance(payload.get("items"), list), "missing_public_items")
    for item in payload["items"]:
        check_summary(item, projects, revisions)


def smoke(client, preparation, samples):
    require(preparation.get("format") == "workshop-full-migration-preparation-v1"
            and preparation.get("diagnostics") == [], "preparation_not_ready")
    tables = preparation["tables"]
    projects = {row["id"]: row for row in tables["projects"] if public(row)}
    private = sorted((row for row in tables["projects"] if not public(row)), key=lambda row: row["id"])
    revisions = {row["id"]: row for row in tables["project_revisions"]}
    objects = {row["targetKey"]: row for row in preparation["objects"]}
    require(projects and private, "missing_public_or_private_smoke_candidates")
    before = client.maintenance()
    require(not before["closed"], "smoke_requires_explicitly_reopened_staging")

    health = client.json("/api/v1/health")
    require(health.get("ok") is True and health.get("service") == "workshop"
            and isinstance(health.get("bindings"), dict)
            and all(health["bindings"].get(key) is True for key in ("db", "r2", "assets")), "unhealthy_staging")
    site = client.json("/api/v1/site")
    require(isinstance(site.get("banner"), dict) and "siteContent" in site, "invalid_site_response")
    home = client.json("/api/v1/home")
    require(all(isinstance(home.get(key), dict) and home[key].get("ok") is True
                for key in ("site", "discovery", "projects")), "home_section_failed")
    check_items(home["projects"]["data"], projects, revisions)
    require(home["projects"]["data"].get("total") == len(projects), "home_total_mismatch")
    check_items(home["discovery"]["data"], projects, revisions)
    discovery = client.json("/api/v1/projects/discovery")
    check_items(discovery, projects, revisions)
    for kind in ("daily", "7d", "30d"):
        ranking = client.json("/api/v1/projects/rankings?" + urlencode({"kind": kind}))
        require(ranking.get("kind") == kind and isinstance(ranking.get("items"), list), "invalid_ranking_response")
        for row in ranking["items"]:
            require(isinstance(row, dict) and isinstance(row.get("rank"), int)
                    and isinstance(row.get("score"), (int, float)), "invalid_ranking_entry")
            check_summary(row.get("project"), projects, revisions)

    cursor = None
    cursors = set()
    seen = set()
    while True:
        query = {"limit": 50, "sort": "updated"}
        if cursor is not None:
            query["cursor"] = cursor
        page = client.json("/api/v1/projects?" + urlencode(query))
        check_items(page, projects, revisions)
        require(page.get("total") == len(projects), "catalog_total_mismatch")
        for item in page["items"]:
            require(item["id"] not in seen, "catalog_duplicate_project")
            seen.add(item["id"])
        cursor = page.get("nextCursor")
        if cursor is None:
            break
        require(isinstance(cursor, str) and cursor and cursor not in cursors and page["items"]
                and len(cursors) <= len(projects), "invalid_catalog_pagination")
        cursors.add(cursor)
    require(seen == set(projects), "catalog_membership_mismatch")

    selected = sorted(projects.values(), key=lambda row: row["id"])[:samples]
    indexed = [row for row in sorted(projects.values(), key=lambda row: row["id"])
               if revisions[row["published_revision_id"]].get("entry_index_ready") == 1
               and entries_for(preparation, row["published_revision_id"])]
    require(indexed, "missing_indexed_smoke_candidate")
    selected = {row["id"]: row for row in selected + indexed[:samples]}
    for project in selected.values():
        path = "/api/v1/projects/" + segment(project["id"])
        check_summary(client.json(path), projects, revisions)
        revision = revisions[project["published_revision_id"]]
        if revision.get("entry_index_ready") == 1:
            payload = client.json(path + "/entries")
            require(payload.get("revisionId") == revision["id"]
                    and payload.get("entries") == entries_for(preparation, revision["id"]), "entry_index_mismatch")
        else:
            client.json(path + "/entries", expected=404, code="not_found")

    incomplete = [row for row in projects.values()
                  if revisions[row["published_revision_id"]].get("entry_index_ready") != 1]
    for project in incomplete:
        path = "/api/v1/projects/" + segment(project["id"])
        check_summary(client.json(path), projects, revisions)
        client.json(path + "/entries", expected=404, code="not_found")

    # Exercise both FTS paths with an actual word, not title decoration or operators.
    searchable = [(row, word) for row in indexed
                  for word in re.findall(r"[^\W_]+", row["title"]) if len(word) >= 3]
    require(searchable, "missing_searchable_smoke_candidate")
    candidate, word = searchable[0]
    for size in (1, 3):
        query = {"limit": 50, "search": word[:size], "authorId": candidate["author_id"]}
        search_seen = set()
        search_cursors = set()
        while True:
            found = client.json("/api/v1/projects?" + urlencode(query))
            check_items(found, projects, revisions)
            require(isinstance(found.get("total"), int), "invalid_search_total")
            for item in found["items"]:
                require(item["id"] not in search_seen, "duplicate_search_project")
                search_seen.add(item["id"])
            cursor = found.get("nextCursor")
            if cursor is None:
                break
            require(isinstance(cursor, str) and cursor and cursor not in search_cursors
                    and found["items"] and len(search_cursors) <= len(projects), "invalid_search_pagination")
            search_cursors.add(cursor)
            query["cursor"] = cursor
        require(candidate["id"] in search_seen and len(search_seen) == found["total"], "search_index_missing_project")

    references = client.json("/api/v1/reference-sets")
    require(isinstance(references.get("items"), list)
            and {row.get("id") for row in references["items"]} == {row["id"] for row in tables["reference_sets"]},
            "reference_set_mismatch")
    recommendations = client.json("/api/v1/recommendations")
    require(isinstance(recommendations.get("items"), list), "missing_recommendations")
    expected_recommendations = {row["id"] for row in tables["recommendations"] if row["project_id"] in projects}
    require(len(expected_recommendations) <= 20, "recommendation_sample_limit_exceeded")
    require({row.get("id") for row in recommendations["items"]} == expected_recommendations,
            "recommendations_mismatch")
    for row in recommendations["items"]:
        check_summary(row.get("project"), projects, revisions)

    covers = []
    for asset in tables["assets"]:
        project = projects.get(asset["project_id"])
        if (project and asset["kind"] == "cover"
                and ((project.get("published_cover_asset_id") is None
                      and asset.get("revision_id") == project["published_revision_id"])
                     or (asset["id"] == project.get("published_cover_asset_id") and asset.get("revision_id") is None))):
            covers.append(asset)
    covers.sort(key=lambda row: row["r2_key"])
    public_cover_keys = {row["r2_key"] for row in covers}
    covers = list({row["r2_key"]: row for row in covers}.values())[:samples]
    require(covers, "missing_public_migrated_asset_candidate")
    verified_bytes = 0
    for asset in covers:
        expected = objects.get(asset["r2_key"])
        require(expected is not None and expected["sha256"] == asset["sha256"]
                and expected["bytes"] == asset["bytes"], "asset_preparation_mismatch")
        status, headers, body = client.request("/api/v1/public-assets/" + quote(asset["r2_key"], safe="/"),
                                               limit=asset["bytes"])
        require(status == 200 and len(body) == asset["bytes"]
                and hashlib.sha256(body).hexdigest() == asset["sha256"], "migrated_asset_bytes_mismatch")
        require(headers.get("access-control-allow-origin") == "*", "public_asset_cors_mismatch")
        verified_bytes += len(body)

    # These are GET-only rejection checks; no ticket, login, draft, or counter is created.
    status, _, _ = client.request(MAINTENANCE)
    require(status == 401, "maintenance_missing_auth_not_rejected")
    for path in ("/api/v1/me", "/api/v1/me/projects", "/api/v1/admin/submissions",
                 "/api/v1/projects/" + segment(indexed[0]["id"]) + "/preview/worldbook",
                 "/api/v1/projects/" + segment(indexed[0]["id"]) + "/preview/regex"):
        client.json(path, expected=401, code="unauthorized")
    for project in private[:samples]:
        path = "/api/v1/projects/" + segment(project["id"])
        client.json(path, expected=404, code="not_found")
        client.json(path + "/entries", expected=404, code="not_found")

    private_covers = [asset for asset in tables["assets"] if asset["kind"] == "cover"
                      and asset["project_id"] not in projects and asset["r2_key"] not in public_cover_keys]
    require(private_covers, "missing_private_asset_candidate")
    content = [asset for asset in tables["assets"] if asset["kind"] in ("worldbook", "regex")]
    require(content, "missing_protected_content_candidate")
    for asset in private_covers[:samples] + content[:samples]:
        for prefix in ("/api/v1/public-assets/", "/api/v1/assets/"):
            client.json(prefix + quote(asset["r2_key"], safe="/"), expected=404, code="not_found")
    after = client.maintenance()
    require(not after["closed"], "maintenance_changed_during_smoke")
    return {"status": "passed", "mode": "smoke", "counts": dict(client.counts),
            "public_projects": len(projects), "private_project_checks": min(samples, len(private)),
            "detail_projects": len(selected), "incomplete_public_indexes": len(incomplete),
            "asset_objects_verified": len(covers), "asset_bytes_verified": verified_bytes,
            "omission_records": len(preparation.get("omissions", [])),
            "maintenance": after,
            "gaps": ["authenticated_workflows_not_exercised", "content_download_bytes_require_real_login",
                     "role_permissions_not_exercised", "no_business_writes_attempted",
                     "scheduled_rebuilds_not_triggered", "local_worker_runtime_not_exercised"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("status", "close", "open", "smoke"))
    parser.add_argument("--token-file", type=Path, required=True,
                        help="existing owner-only maintenance token file; never a Cloudflare or legacy token")
    parser.add_argument("--preparation", type=Path, help="validated private full-snapshot preparation; required for smoke")
    parser.add_argument("--samples", type=int, default=3, help="representative detail/private/asset checks (1-10)")
    parser.add_argument("--timeout", type=int, default=60, help="per-request timeout in seconds (1-300)")
    args = parser.parse_args()
    require(1 <= args.samples <= 10 and 1 <= args.timeout <= 300, "invalid_numeric_option")
    require(args.mode != "smoke" or args.preparation is not None, "smoke_requires_preparation")
    client = Staging(read_token(args.token_file), args.timeout)
    if args.mode == "smoke":
        with args.preparation.open(encoding="utf-8") as source:
            preparation = json.load(source)
        result = smoke(client, preparation, args.samples)
    else:
        result = {"mode": args.mode, "status": "passed",
                  "maintenance": client.maintenance(None if args.mode == "status" else args.mode),
                  "counts": dict(client.counts)}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except ControlError as error:
        print(json.dumps({"status": "failed", "error": str(error)}), file=sys.stderr)
        raise SystemExit(1) from None
    except Exception:
        print(json.dumps({"status": "failed", "error": "invalid_local_input_or_response"}), file=sys.stderr)
        raise SystemExit(1) from None

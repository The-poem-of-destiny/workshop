#!/usr/bin/env python3
"""Inspect a migration preparation or reconcile a local SQLite snapshot.

All inputs are local. Reports contain counts and schema names, not row values.
The optional source check independently accounts for source-backed identities,
projects, relationships, references, audit records, recommendations, content
indexes and approved omissions. It does not prove database identity or privacy.

  python3 tools/migrate/full-load.py plan PREPARATION.json --migrations DIR
  python3 tools/migrate/full-load.py reconcile PREPARATION.json SNAPSHOT.sqlite
  python3 tools/migrate/full-load.py reconcile PREPARATION.json SNAPSHOT.sqlite --source DUMP.sql --manifest MANIFEST.json
  python3 tools/migrate/full-load.py source PREPARATION.json DUMP.sql MANIFEST.json
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from collections import Counter
from urllib.parse import unquote, urlparse
import sqlite3
import subprocess
import sys
from pathlib import Path


def load_validator():
    path = Path(__file__).with_name("full-validate.py")
    spec = importlib.util.spec_from_file_location("full_validate", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preparation(path):
    value = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(value, dict)
            or value.get("format") != "workshop-full-migration-preparation-v1"
            or not isinstance(value.get("tables"), dict)
            or not isinstance(value.get("diagnostics"), list)):
        raise ValueError("invalid preparation structure")
    return value


def plan(data, directory):
    validator = load_validator()
    report = validator.validate(data, directory)
    migrations = validator.migration_files(directory)
    # This remains deliberately non-executable, including when SQLite passes:
    # source-to-target accounting and a staging cutover procedure are separate gates.
    return {
        "format": "workshop-full-load-plan-v1",
        "executable": False,
        "source_reconciliation_verified": False,
        "object_transfer_verified": False,
        "migration_chain": [{"name": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                            for p in migrations],
        "table_candidates": {name: len(rows) for name, rows in data["tables"].items()
                             if isinstance(name, str) and isinstance(rows, list)},
        "sqlite_validation": report,
        "blockers": ["independent source-to-target reconciliation not established",
                     "R2 transfer and privacy not verified",
                     "staging identity, quiescence, backup and atomic cutover not established"],
    }


def quote(name):
    return '"' + name.replace('"', '""') + '"'


MISSING_DRAFTS = frozenset({
    "6497309b-990f-486c-ae32-06b675226e6e",
    "726d5157-9716-4863-9175-732bf8469dcf",
})


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def version_id(source_id):
    return "legacy-revision-" + hashlib.sha256(stable([source_id]).encode()).hexdigest()


def source_metadata(row):
    return (row.get("name"), row.get("description"), None, row.get("project_type"),
            row.get("extension_type"), row.get("version_label") or row.get("version"),
            stable({"schemaVersion": 1, "dependencies": [], "conflicts": [], "notes": row["precautions"]}) if row.get("precautions") is not None else None,
            row.get("cover_position_x"), row.get("cover_position_y"),
            row.get("cover_zoom"))


def candidate_metadata(row):
    return tuple(row.get(field) for field in (
        "title", "description", "author_note", "project_type", "extension_type", "version_label",
        "requirements", "cover_position_x", "cover_position_y", "cover_zoom"))


def source_tags(row):
    """Independently account for the ordered flat projection of legacy tags."""
    tags = []
    for field, default in (("tags", []), ("custom_tags", []), ("facets", {})):
        value = json.loads(row[field]) if row.get(field) not in (None, "") else default
        if field == "facets":
            if not isinstance(value, dict) or any(not isinstance(group, list) for group in value.values()):
                raise ValueError("invalid source facets")
            groups = value.values()
        else:
            if not isinstance(value, list):
                raise ValueError("invalid source tags")
            groups = [value]
        for group in groups:
            for tag in group:
                if not isinstance(tag, str) or not tag.strip():
                    raise ValueError("invalid source tag")
                if tag not in tags:
                    tags.append(tag)
    if len(tags) > 20:
        raise ValueError("source tags exceed current limit")
    return stable(tags)



def source_reconcile(data, dump, manifest_path):
    """Compare source facts to candidates without invoking the transformer."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    raw = dump.read_bytes()
    databases = [item for item in manifest.get("databases", []) if item.get("name") == "creative_workshop"]
    if len(databases) != 1 or hashlib.sha256(raw).hexdigest() != databases[0].get("sha256"):
        raise ValueError("source dump does not match manifest")
    db = sqlite3.connect(":memory:")
    try:
        db.executescript(raw.decode("utf-8"))
        db.row_factory = sqlite3.Row
        names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        required = {"users", "projects", "project_likes", "project_subscribes",
                    "project_ratings", "project_metric_daily", "daily_random_draw_state",
                    "devteam_recommendations", "admins", "super_admins",
                    "character_references", "character_reference_versions", "character_reference_items",
                    "site_settings", "admin_action_logs", "project_metadata_audit_logs",
                    "discovery_feature_history"}
        if not required <= names:
            raise ValueError("missing source tables")
        source = {name: [dict(row) for row in db.execute("SELECT * FROM " + quote(name))]
                  for name in required}
        source["devteam_curators"] = ([dict(row) for row in db.execute("SELECT * FROM devteam_curators")]
                                      if "devteam_curators" in names else [])
        counts = databases[0].get("table_counts", {})
        if not isinstance(counts, dict):
            raise ValueError("invalid manifest counts")
        for name, count in counts.items():
            if name not in names or db.execute("SELECT count(*) FROM " + quote(name)).fetchone()[0] != count:
                raise ValueError("source table count differs from manifest")
    finally:
        db.close()

    report = {"format": "workshop-full-source-reconciliation-v1", "ok": False,
              "checks": {}, "failures": [],
              "scope": "identities, projects, relationships, audit records, recommendations, content indexes and approved exclusions (including removed reference baselines)"}
    failures = report["failures"]

    def compare(label, expected, actual):
        expected, actual = Counter(expected), Counter(actual)
        missing = sum((expected - actual).values())
        extra = sum((actual - expected).values())
        report["checks"][label] = {"expected": sum(expected.values()), "actual": sum(actual.values()),
                                    "missing": missing, "extra": extra}
        if missing or extra:
            failures.append({"kind": "source_difference", "check": label})

    tables = data["tables"]
    required_targets = {"users", "projects", "project_versions", "project_likes",
                        "project_subscriptions", "project_ratings", "project_metrics_daily",
                        "site_settings",
                        "audit_events", "recommendations", "assets"}
    for name in sorted(set(tables) - required_targets):
        failures.append({"kind": "unexpected_target_table", "table": name})
    for name in sorted(required_targets):
        if not isinstance(tables.get(name), list):
            failures.append({"kind": "missing_or_invalid_target_table", "table": name})
            tables = dict(tables, **{name: []})
    projects = {str(row["id"]): row for row in source["projects"]}
    if len(projects) != len(source["projects"]):
        raise ValueError("duplicate source project IDs")
    roots = {pid: str(row.get("root_project_id") or pid) for pid, row in projects.items()}
    if any(root not in projects or roots.get(root) != root for root in roots.values()):
        failures.append({"kind": "invalid_source_project_roots"})
    bases = {pid: row for pid, row in projects.items() if roots[pid] == pid}
    excluded_roots = {pid for pid, row in bases.items() if str(row.get("draft_project_id")) in MISSING_DRAFTS}
    excluded = {pid for pid, root in roots.items() if root in excluded_roots}
    relation_ids = {pid for root, base in bases.items() if root not in excluded_roots
                    for pid in (root, str(base.get("draft_project_id") or root),
                                str(base.get("published_project_id") or
                                    (root if base.get("is_published") else root)))}
    subscriptions = Counter(roots.get(str(row["project_id"])) for row in source["project_subscribes"]
                            if str(row["project_id"]) in relation_ids)
    expected_projects = []
    expected_revisions = []
    current_ids = set()
    private_roots = set()
    for root, base in bases.items():
        if root in excluded_roots:
            continue
        draft = str(base.get("draft_project_id") or root)
        published = base.get("published_project_id") or (root if base.get("is_published") else None)
        published = str(published) if published is not None else None
        if roots.get(draft) != root or (published is not None and roots.get(published) != root):
            failures.append({"kind": "unresolved_source_project_pointer"})
            continue
        pub = projects.get(published) if published else None
        visibility = "public" if pub and pub.get("visibility") == 1 else "private"
        if visibility == "private":
            private_roots.add(root)
        projection = pub if pub is not None else projects[draft]
        expected_projects.append((root, str(base["author_id"]), version_id(draft),
                                  version_id(published) if published else None, visibility,
                                  (pub.get("latest_approved_at") or pub.get("reviewed_at")) if pub else None,
                                  (pub.get("latest_approved_at") or pub.get("reviewed_at")) if pub else None,
                                  base.get("downloads_count") or 0, base.get("likes_count") or 0,
                                  subscriptions[root], base.get("created_at"), base.get("updated_at"), None))
        for pid in {draft, published} - {None}:
            current_ids.add(pid)
            expected_revisions.append((version_id(pid), root, str(projects[pid]["author_id"]),
                                       *source_metadata(projects[pid]), source_tags(projects[pid]),
                                       projects[pid].get("discord_thread_url")))
    compare("users", ((str(row["id"]), row.get("username"), row.get("global_name"),
                       row.get("avatar"), "member", row.get("created_at"), row.get("updated_at"))
                      for row in source["users"]),
            ((str(row["id"]), row.get("username"), row.get("global_name"), row.get("avatar"),
              row.get("role"), row.get("created_at"), row.get("updated_at")) for row in tables.get("users", [])))
    compare("projects", expected_projects,
            ((str(row["id"]), str(row["author_id"]), row.get("working_version_id"),
              row.get("published_version_id"), row.get("visibility"),
              row.get("published_at"), row.get("published_updated_at"), row.get("downloads_count"),
              row.get("likes_count"), row.get("subscriptions_count"), row.get("created_at"),
              row.get("updated_at"), row.get("deleted_at")) for row in tables.get("projects", [])))
    compare("current_revisions", expected_revisions,
            ((row["id"], str(row["project_id"]), str(row["created_by"]), *candidate_metadata(row),
              row.get("tags"), row.get("discord_thread_url")) for row in tables.get("project_versions", [])))

    for source_name, target_name, fields in (
        ("project_likes", "project_likes", ("user_id", "created_at")),
        ("project_subscribes", "project_subscriptions", ("user_id", "created_at")),
        ("project_ratings", "project_ratings", ("user_id", "rating", "comment_text", "created_at", "updated_at")),
        ("project_metric_daily", "project_metrics_daily", ("day_key", "downloads", "likes_delta")),
    ):
        expected = ((roots.get(str(row["project_id"])), *(row.get(field) for field in fields))
                    for row in source[source_name] if str(row["project_id"]) in relation_ids)
        actual = ((str(row["project_id"]), *(row.get(field) for field in fields))
                  for row in tables.get(target_name, []))
        compare(target_name, expected, actual)

    for source_name, target_name, rename in (
        ("site_settings", "site_settings", {}),
    ):
        compare(target_name,
                (stable({rename.get(key, key): value for key, value in row.items()})
                 for row in source[source_name]),
                (stable(row) for row in tables[target_name]))

    users = {str(row["id"]) for row in source["users"]
             if row.get("username") and row.get("created_at") and row.get("updated_at")}
    accepted_roots = set(bases) - excluded_roots
    audit_events = []
    missing_actors = {"admin_action_logs": [], "project_metadata_audit_logs": []}
    removed_audits = []
    for name in missing_actors:
        for row in source[name]:
            if name == "admin_action_logs" and row.get("action") in ("project_approved", "project_rejected", "public_project_counts_recounted"):
                removed_audits.append(stable(row))
                continue
            if name == "admin_action_logs" and row.get("action") not in {"admin_added", "admin_removed", "character_reference_created", "character_reference_version_created", "editor_pick_removed", "editor_pick_saved", "compatibility_updated"}:
                failures.append({"kind": "unsupported_closed_audit_action"})
                continue
            if (not all(row.get(field) for field in ("id", "action", "actor_id", "created_at"))
                    or (name == "admin_action_logs" and not row.get("target_type"))
                    or (name == "project_metadata_audit_logs" and not row.get("project_id"))):
                failures.append({"kind": "invalid_source_audit_record", "table": name})
                continue
            actor = str(row["actor_id"])
            if actor not in users:
                missing_actors[name].append(stable({"id": row["id"], "actor_id": actor}))
                actor = None
            target_type = row.get("target_type") if name == "admin_action_logs" else "project"
            target_id = row.get("target_id") if name == "admin_action_logs" else row.get("project_id")
            if target_type in ("project", "project_draft") and target_id is not None:
                root = roots.get(str(target_id))
                if root in accepted_roots:
                    target_id = root
            detail = {"sourceTable": name, "legacyActorId": str(row["actor_id"]),
                      "legacyActorName": row.get("actor_name"),
                      "legacyTargetId": str(row.get("target_id") if name == "admin_action_logs" else row.get("project_id")) if (row.get("target_id") if name == "admin_action_logs" else row.get("project_id")) is not None else None}
            metadata = name == "project_metadata_audit_logs" or row.get("action") == "compatibility_updated"
            if metadata:
                payload = json.loads(row["detail"]) if name == "admin_action_logs" and row.get("detail") else row
                detail.update(beforeValue=payload.get("beforeValue", payload.get("before_value")), afterValue=payload.get("afterValue", payload.get("after_value")))
            else:
                detail["legacyDetail"] = row.get("detail")
            audit_events.append(stable({
                "id": "legacy-audit-" + hashlib.sha256(stable([name, row["id"]]).encode()).hexdigest(),
                "action": "project.patch" if metadata else "legacy." + str(row["action"]), "target_type": target_type,
                "target_id": target_id, "actor_id": actor, "detail": stable(detail),
                "created_at": row["created_at"],
            }))
    compare("audit_events", audit_events, (stable(row) for row in tables["audit_events"]))

    enabled = {str(row["user_id"]) for row in source["devteam_curators"] if row.get("enabled") == 1}
    authorized = {str(row["user_id"]) for row in source["super_admins"]}
    authorized.update(str(row["id"]) for row in source["users"] if row.get("is_admin") == 1)
    recommendations = []
    recommendation_keys = Counter()
    unattributed_recommendations = []
    for row in source["devteam_recommendations"]:
        project = row.get("project_id")
        root = roots.get(str(project)) if project is not None else None
        if root in excluded_roots:
            continue
        curator = str(row["curator_id"]) if row.get("curator_id") is not None else None
        project_row = projects.get(str(project), {})
        if (curator not in users or root not in accepted_roots or curator not in enabled
                or curator not in authorized or project_row.get("status") != "approved"
                or project_row.get("is_published") != 1 or project_row.get("visibility") != 1
                or any(row.get(field) is None for field in ("comment_text", "reaction_label", "created_at", "updated_at"))
                or not row.get("created_at") or not row.get("updated_at")):
            failures.append({"kind": "invalid_source_recommendation"})
            continue
        base = bases[root]
        published_source = str(base.get("published_project_id") or root)
        published = projects.get(published_source)
        published_at = (published.get("latest_approved_at") or published.get("reviewed_at")) if published else None
        if (published is None or not published_at or not published.get("created_at")
                or published_at > row["created_at"] or published["created_at"] > row["created_at"]):
            unattributed_recommendations.append(stable(row))
            continue
        recommendation_keys[(curator, root)] += 1
        recommendations.append(stable({
            "id": "legacy-recommendation-" + hashlib.sha256(stable([curator, root]).encode()).hexdigest(),
            "curator_id": curator, "project_id": root, "project_version_id": version_id(published_source), "comment": row["comment_text"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        }))
    if any(count != 1 for count in recommendation_keys.values()):
        failures.append({"kind": "duplicate_source_recommendation"})
    compare("recommendations", recommendations, (stable(row) for row in tables["recommendations"]))

    omissions = data.get("omissions")
    if not isinstance(omissions, list):
        failures.append({"kind": "missing_omissions"})
        omissions = []
    approved_pairs = {
        ("projects", "excluded project with known missing draft"),
        ("projects", "historical revision outside current snapshot"),
        ("daily_random_draw_state", "daily draw excluded from migration"),
        ("r2", "zero-byte worldbook omitted"),
        ("devteam_recommendations", "recommendation belongs to excluded project"),
        ("devteam_recommendations", "recommendation current version attribution unavailable; source backup retained"),
        ("users", "legacy privileges not migrated"),
        ("admins", "legacy privileges not migrated"),
        ("super_admins", "legacy privileges not migrated"),
        ("projects", "legacy submission/review/check history not reconstructed"),
        ("projects", "worldbook duplicates validated regex asset"),
        ("projects", "source revision has no content asset"),
        ("projects", "content index unavailable: duplicate entry keys"),
        ("projects", "legacy metadata has no snapshot mapping"),
        ("discovery_feature_history", "legacy daily feature history excluded from snapshot"),
        ("admin_action_logs", "missing audit actor retained in detail"),
        ("admin_action_logs", "obsolete review/count audit excluded; source backup retained"),
        ("project_metadata_audit_logs", "missing audit actor retained in detail"),
        ("character_references", "reference baseline feature removed (R-18); source backup retained"),
        ("character_reference_versions", "reference baseline feature removed (R-18); source backup retained"),
        ("character_reference_items", "reference baseline feature removed (R-18); source backup retained"),
    } | {(name, reason) for name in
         ("project_likes", "project_subscribes", "project_ratings", "project_metric_daily")
         for reason in ("relation belongs to excluded project", "relation belongs to omitted historical revision")}
    omission_counts = Counter((item.get("table"), item.get("reason")) for item in omissions
                              if isinstance(item, dict) and isinstance(item.get("table"), str)
                              and isinstance(item.get("reason"), str))
    report["omissions"] = [{"table": table, "reason": reason, "count": count}
                           for (table, reason), count in sorted(omission_counts.items())]
    for item in omissions:
        reason = item.get("reason") if isinstance(item, dict) else None
        optional_invalid = (isinstance(item, dict) and item.get("table") == "projects"
                            and isinstance(reason, str) and reason.startswith("invalid content asset omitted: ")
                            and len(reason) > len("invalid content asset omitted: "))
        if (not isinstance(item, dict) or ((item.get("table"), reason) not in approved_pairs and not optional_invalid)
                or "source" not in item):
            failures.append({"kind": "unapproved_omission"})
    def omitted(table, reason):
        return (stable(item.get("source")) for item in omissions
                if isinstance(item, dict) and item.get("table") == table and item.get("reason") == reason)
    compare("removed_review_count_audits", removed_audits, omitted("admin_action_logs", "obsolete review/count audit excluded; source backup retained"))
    compare("excluded_projects", (stable(projects[pid]) for pid in excluded),
            omitted("projects", "excluded project with known missing draft"))
    compare("historical_revisions", (stable(row) for pid, row in projects.items()
                                     if pid not in excluded and pid not in current_ids),
            omitted("projects", "historical revision outside current snapshot"))
    compare("daily_draw_exclusions", (stable(row) for row in source["daily_random_draw_state"]),
            omitted("daily_random_draw_state", "daily draw excluded from migration"))
    for name in ("character_references", "character_reference_versions", "character_reference_items"):
        compare(name + "_exclusions", (stable(row) for row in source[name]),
                omitted(name, "reference baseline feature removed (R-18); source backup retained"))
    compare("discovery_feature_history_exclusions",
            (stable(row) for row in source["discovery_feature_history"]),
            omitted("discovery_feature_history", "legacy daily feature history excluded from snapshot"))
    for name, expected in missing_actors.items():
        compare(name + "_missing_actor_exclusions", expected,
                omitted(name, "missing audit actor retained in detail"))
    for name in ("admins", "super_admins"):
        compare(name + "_privilege_exclusions", (stable(row) for row in source[name]),
                omitted(name, "legacy privileges not migrated"))
    for name in ("project_likes", "project_subscribes", "project_ratings", "project_metric_daily"):
        compare(name + "_exclusions", (stable(row) for row in source[name]
                                      if roots.get(str(row["project_id"])) in excluded_roots),
                omitted(name, "relation belongs to excluded project"))
        compare(name + "_historical_exclusions", (stable(row) for row in source[name]
                                                  if str(row["project_id"]) in roots
                                                  and str(row["project_id"]) not in excluded
                                                  and str(row["project_id"]) not in relation_ids),
                omitted(name, "relation belongs to omitted historical revision"))
    compare("recommendation_exclusions", (stable(row) for row in source["devteam_recommendations"]
                                           if roots.get(str(row["project_id"])) in excluded_roots),
            omitted("devteam_recommendations", "recommendation belongs to excluded project"))
    compare("unattributed_recommendation_exclusions", unattributed_recommendations,
            omitted("devteam_recommendations", "recommendation current version attribution unavailable; source backup retained"))

    manifest_objects = {}
    for bucket, info in manifest.get("buckets", {}).items():
        for obj in info.get("objects", []):
            key = (bucket, obj["key"])
            if key in manifest_objects:
                raise ValueError("duplicate manifest object")
            manifest_objects[key] = obj
    source_assets = []
    backup_root = (manifest_path.parent / "r2").resolve()
    for pid in sorted(current_ids):
        version = projects[pid]
        references = (("worldbook", version.get("download_url")),
                      ("cover", version.get("cover_image")),
                      ("regex", "projects/" + pid + "/regex-" + pid + ".json"))
        for kind, value in references:
            if not value:
                continue
            parsed = urlparse(value)
            path = unquote(parsed.path)
            if "/api/files/" in path:
                key = path.split("/api/files/", 1)[1]
            elif parsed.scheme or parsed.netloc:
                failures.append({"kind": "unrecognized_source_asset_url"})
                continue
            else:
                key = path.lstrip("/")
            if not key or ".." in key.split("/"):
                failures.append({"kind": "invalid_source_asset_key"})
                continue
            candidates = [(bucket, key) for bucket in ("creative-workshop-projects", "creative-workshop-uploads")
                          if (bucket, key) in manifest_objects]
            if len(candidates) != 1:
                if kind != "regex" or candidates:
                    failures.append({"kind": "missing_or_ambiguous_source_asset", "asset_kind": kind})
                continue
            bucket, key = candidates[0]
            obj = manifest_objects[(bucket, key)]
            backup_path = (backup_root / bucket / key).resolve()
            if not backup_path.is_relative_to(backup_root):
                raise ValueError("source object escapes backup directory")
            source_assets.append({
                "id": stable([pid, kind]), "source_id": pid, "kind": kind,
                "path": str(backup_path), "bucket": bucket, "key": key,
                "sha256": obj.get("sha256"), "bytes": obj.get("size"),
                "target": ("covers/imported/" if kind == "cover" else "projects/imported/") + str(obj.get("sha256")),
            })

    # The domain helper derives entries only from original, integrity-checked
    # backup bytes. Neither preparation indexes nor omission claims are inputs.
    validations = {}
    if source_assets:
        helper = Path(__file__).with_name("full-transform-content.mjs")
        completed = subprocess.run(["node", "--experimental-strip-types", str(helper)],
                                   input=stable(source_assets), text=True, capture_output=True, check=False)
        if completed.returncode:
            raise ValueError("source content extractor failed")
        results = json.loads(completed.stdout)
        if not isinstance(results, list) or any(not isinstance(item, dict) for item in results):
            raise ValueError("invalid source content extraction result")
        validations = {item.get("id"): item for item in results}
        if len(results) != len(validations) or set(validations) != {asset["id"] for asset in source_assets}:
            raise ValueError("source content extractor did not account for every asset")
    valid_content = {asset["source_id"] for asset in source_assets
                     if asset["kind"] in ("worldbook", "regex")
                     and not validations[asset["id"]].get("error")}
    valid_regex = {(asset["source_id"], asset["sha256"], asset["bytes"]) for asset in source_assets
                   if asset["kind"] == "regex" and not validations[asset["id"]].get("error")}
    empty_worldbooks = []
    empty_worldbook_ids = set()
    expected_assets = []
    expected_objects = set()
    allowed_object_sources = set()
    duplicate_exclusions = []
    invalid_exclusions = []
    index_exclusions = []
    retained_assets = []
    extracted_entries = []
    incomplete = set()
    for asset in source_assets:
        pid, kind = asset["source_id"], asset["kind"]
        rid = version_id(pid)
        validation = validations[asset["id"]]
        error = validation.get("error")
        if error and validation.get("stage") != "content":
            failures.append({"kind": "source_object_integrity_failed", "asset_kind": kind})
            incomplete.add(rid)
            continue
        if kind == "worldbook" and asset["bytes"] == 0:
            empty_worldbooks.append(stable({"bucket": asset["bucket"], "key": asset["key"]}))
            empty_worldbook_ids.add(pid)
            continue
        content_identity = {"id": projects[pid]["id"], "kind": kind, "sha256": asset["sha256"]}
        if error:
            if (kind == "worldbook" and error != "duplicate entry keys"
                    and (pid, asset["sha256"], asset["bytes"]) in valid_regex):
                allowed_object_sources.add((asset["bucket"], asset["key"], asset["target"], asset["sha256"], asset["bytes"]))
                duplicate_exclusions.append(stable({"id": projects[pid]["id"], "sha256": asset["sha256"]}))
                continue
            if kind in ("worldbook", "regex") and error == "duplicate entry keys":
                index_exclusions.append(stable(content_identity))
                incomplete.add(rid)
            elif kind in ("worldbook", "regex") and (pid in valid_content or roots[pid] in private_roots):
                invalid_exclusions.append((stable(content_identity), "invalid content asset omitted: " + error))
                if pid not in valid_content:
                    incomplete.add(rid)
                continue
            else:
                failures.append({"kind": "unapproved_source_content_error", "asset_kind": kind})
                incomplete.add(rid)
                continue
        else:
            extracted_entries.extend((rid, entry["kind"], entry["entry_key"], entry["name"],
                                      entry["content_hash"], entry["content_length"])
                                     for entry in validation["entries"])
        retained_assets.append(asset)
        expected_assets.append((roots[pid], rid, kind, asset["target"], asset["sha256"], asset["bytes"]))
        expected_objects.add((asset["target"], asset["sha256"], asset["bytes"]))
        allowed_object_sources.add((asset["bucket"], asset["key"], asset["target"], asset["sha256"], asset["bytes"]))

    compare("zero_byte_worldbook_exclusions", empty_worldbooks,
            omitted("r2", "zero-byte worldbook omitted"))
    compare("duplicate_worldbook_exclusions", duplicate_exclusions,
            omitted("projects", "worldbook duplicates validated regex asset"))
    compare("invalid_content_exclusions", invalid_exclusions,
            ((stable(item.get("source")), item["reason"]) for item in omissions if isinstance(item, dict)
             and item.get("table") == "projects" and isinstance(item.get("reason"), str)
             and item["reason"].startswith("invalid content asset omitted: ")))
    compare("duplicate_index_omissions", index_exclusions,
            omitted("projects", "content index unavailable: duplicate entry keys"))
    content_ids = {asset["source_id"] for asset in retained_assets if asset["kind"] in ("worldbook", "regex")}
    compare("no_content_omissions",
            (stable({"id": projects[pid]["id"]}) for pid in current_ids
             if pid not in empty_worldbook_ids and pid not in content_ids and version_id(pid) not in incomplete),
            omitted("projects", "source revision has no content asset"))
    expected_entries = [entry for entry in extracted_entries if entry[0] not in incomplete]
    actual_entries = []
    for row in tables["project_versions"]:
        document = json.loads(row["entry_index"]) if row.get("entry_index") is not None else None
        if document is not None:
            if document.get("schemaVersion") != 1 or set(document) != {"schemaVersion", "entries"}:
                failures.append({"kind": "invalid_version_index_document"})
            actual_entries.extend((row["id"], e["kind"], e["entryKey"], e["name"], e["contentHash"], e["contentLength"]) for e in document["entries"])
    compare("version_entry_index", expected_entries, actual_entries)
    index_counts = Counter((entry[0], entry[1]) for entry in expected_entries)
    assets_by_revision = {}
    for asset in retained_assets:
        assets_by_revision.setdefault(version_id(asset["source_id"]), []).append(asset)
    expected_readiness = []
    for pid in current_ids:
        rid = version_id(pid)
        hashes = "\n".join(asset["kind"] + ":" + asset["sha256"] for asset in
                           sorted(assets_by_revision.get(rid, []), key=lambda asset: (asset["kind"], asset["target"])))
        expected_readiness.append((rid, int(rid not in incomplete),
                                   index_counts[(rid, "worldbook")], index_counts[(rid, "regex")],
                                   hashlib.sha256(hashes.encode()).hexdigest() if rid not in incomplete else None))
    compare("revision_content_readiness", expected_readiness,
            ((row.get("id"), int(row.get("entry_index") is not None), row.get("worldbook_count"),
              row.get("regex_count"), row.get("manifest_hash")) for row in tables["project_versions"]))
    report["incomplete_content_revisions"] = len(incomplete)
    compare("assets", expected_assets,
            ((str(row["project_id"]), row.get("version_id"), row.get("kind"), row.get("r2_key"),
              row.get("sha256"), row.get("bytes")) for row in tables.get("assets", [])))
    objects = data.get("objects", [])
    compare("objects", expected_objects,
            ((row.get("targetKey"), row.get("sha256"), row.get("bytes")) for row in objects))
    if any((row.get("sourceBucket"), row.get("sourceKey"), row.get("targetKey"), row.get("sha256"),
            row.get("bytes")) not in allowed_object_sources for row in objects):
        failures.append({"kind": "invalid_object_source"})
    if data["diagnostics"]:
        failures.append({"kind": "preparation_diagnostics", "count": len(data["diagnostics"])})
    report["ok"] = not failures
    return report


def reconcile(data, snapshot):
    uri = snapshot.resolve().as_uri() + "?mode=ro"
    db = sqlite3.connect(uri, uri=True)
    db.row_factory = sqlite3.Row
    report = {"format": "workshop-full-load-reconciliation-v1", "ok": False,
              "source_reconciliation_verified": False, "tables": {}, "failures": []}
    failures = report["failures"]
    try:
        db.execute("PRAGMA query_only = ON")
        db.execute("BEGIN")
        schema = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for name, rows in sorted(data["tables"].items()):
            if not isinstance(name, str) or name not in schema or not isinstance(rows, list):
                failures.append({"kind": "invalid_or_missing_candidate_table"})
                continue
            info = list(db.execute("PRAGMA table_xinfo(" + quote(name) + ")"))
            columns = {r[1] for r in info if r[6] == 0}
            primary = [r[1] for r in sorted((r for r in info if r[5]), key=lambda r: r[5])]
            result = {"candidates": len(rows), "matched": 0, "missing": 0,
                      "different": 0, "invalid": 0, "extra": 0, "different_columns": {}}
            report["tables"][name] = result
            actual_count = db.execute("SELECT count(*) FROM " + quote(name)).fetchone()[0]
            if not primary:
                failures.append({"kind": "table_without_primary_key", "table": name})
                continue
            seen = set()
            for row in rows:
                if (not isinstance(row, dict) or any(not isinstance(k, str) or k not in columns for k in row)
                        or any(key not in row or row[key] is None for key in primary)
                        or any(not isinstance(v, (str, int, float, type(None))) for v in row.values())):
                    result["invalid"] += 1
                    continue
                sql = "SELECT * FROM " + quote(name) + " WHERE " + " AND ".join(quote(k) + " IS ?" for k in primary)
                matches = db.execute(sql, tuple(row[k] for k in primary)).fetchall()
                if not matches:
                    result["missing"] += 1
                    continue
                if len(matches) != 1:
                    result["invalid"] += 1
                    continue
                actual = matches[0]
                identity = tuple(actual[k] for k in primary)
                if identity in seen:
                    result["invalid"] += 1
                    continue
                seen.add(identity)
                different = [key for key, value in row.items() if actual[key] != value]
                if different:
                    result["different"] += 1
                    for key in different:
                        result["different_columns"][key] = result["different_columns"].get(key, 0) + 1
                else:
                    result["matched"] += 1
            result["extra"] = actual_count - len(seen)
            if result["missing"] or result["different"] or result["invalid"] or result["extra"]:
                failures.append({"kind": "table_difference", "table": name})
        if "project_like_events" in schema and "project_like_events" not in data["tables"]:
            metrics = data["tables"].get("project_metrics_daily", [])
            if isinstance(metrics, list) and all(
                isinstance(row, dict) and isinstance(row.get("project_id"), str)
                and isinstance(row.get("day_key"), str)
                and isinstance(row.get("likes_delta", 0), (int, float))
                for row in metrics
            ):
                expected = Counter(
                    (row["project_id"], row.get("likes_delta", 0),
                     row["day_key"] + "T00:00:00.000Z", "legacy_daily")
                    for row in metrics if row.get("likes_delta", 0) != 0
                )
                actual = Counter(tuple(row) for row in db.execute(
                    "SELECT project_id, delta, occurred_at, source FROM project_like_events"))
                missing = sum((expected - actual).values())
                extra = sum((actual - expected).values())
                report["derived_project_like_events"] = {
                    "expected": sum(expected.values()), "actual": sum(actual.values()),
                    "missing": missing, "extra": extra,
                }
                if missing or extra:
                    failures.append({"kind": "derived_project_like_events_difference"})
            else:
                failures.append({"kind": "invalid_derived_project_like_events_source"})
        fk_count = sum(1 for _ in db.execute("PRAGMA foreign_key_check"))
        if fk_count:
            failures.append({"kind": "foreign_key_violations", "count": fk_count})
        validator = load_validator()
        integrity = validator.application_integrity(db, data)
        failures.extend(integrity["failures"])
        report["accepted_exceptions"] = integrity["accepted_exceptions"]
        failures.extend(validator.stored_size_failures(db))
        report["ok"] = not failures and not data["diagnostics"]
        if data["diagnostics"]:
            failures.append({"kind": "preparation_diagnostics", "count": len(data["diagnostics"])})
    finally:
        db.close()
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan")
    p.add_argument("preparation", type=Path)
    p.add_argument("--migrations", type=Path, required=True)
    p = sub.add_parser("reconcile")
    p.add_argument("preparation", type=Path)
    p.add_argument("snapshot", type=Path)
    p.add_argument("--source", type=Path)
    p.add_argument("--manifest", type=Path)
    p = sub.add_parser("source")
    p.add_argument("preparation", type=Path)
    p.add_argument("source", type=Path)
    p.add_argument("manifest", type=Path)
    args = parser.parse_args()
    try:
        data = preparation(args.preparation)
        if args.command == "plan":
            result = plan(data, args.migrations)
        elif args.command == "source":
            result = source_reconcile(data, args.source, args.manifest)
        else:
            if bool(args.source) != bool(args.manifest):
                raise ValueError("source and manifest must be supplied together")
            result = reconcile(data, args.snapshot)
            if args.source:
                source_result = source_reconcile(data, args.source, args.manifest)
                result["source_checks"] = source_result
                result["source_reconciliation_verified"] = source_result["ok"]
                result["ok"] = result["ok"] and source_result["ok"]
    except (OSError, UnicodeError, ValueError, TypeError, sqlite3.Error, json.JSONDecodeError):
        print(json.dumps({"ok": False, "error": "input_or_schema_error"}))
        return 1
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if args.command != "plan" and result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())

"""Map legacy audit records and recommendations without inventing history.

The caller supplies its existing target tables, diagnostic callback, project-root
mapping, accepted roots, mapped users and deterministic identifier function.
Discovery feature history has no equivalent in the current hourly exposure model;
those rows are reported rather than used to alter the live discovery feed.
"""
from collections import defaultdict
import json


def transform_history(source, tables, issue, omit, roots, accepted_roots, excluded_roots, users, identifier):
    """Append supported records and report unresolved and omitted records."""
    for table in ("admin_action_logs", "project_metadata_audit_logs"):
        for row in source.get(table, []):
            if table == "admin_action_logs" and row.get("action") in ("project_approved", "project_rejected", "public_project_counts_recounted"):
                omit(table, row, "obsolete review/count audit excluded; source backup retained")
                continue
            allowed = {"admin_added", "admin_removed", "character_reference_created", "character_reference_version_created", "editor_pick_removed", "editor_pick_saved", "compatibility_updated"}
            if table == "admin_action_logs" and row.get("action") not in allowed:
                issue(table, row, "unsupported closed audit action")
                continue
            if not all(row.get(field) for field in ("id", "action", "actor_id", "created_at")):
                issue(table, row, "audit record lacks required identity, action, actor, or timestamp")
                continue
            if table == "admin_action_logs" and not row.get("target_type"):
                issue(table, row, "audit record lacks target type")
                continue
            actor = str(row["actor_id"])
            if actor not in users:
                omit(table, {"id": row["id"], "actor_id": actor}, "missing audit actor retained in detail")
                actor = None
            target_type = row.get("target_type") if table == "admin_action_logs" else "project"
            target_id = row.get("target_id") if table == "admin_action_logs" else row.get("project_id")
            if table == "project_metadata_audit_logs" and not target_id:
                issue(table, row, "metadata audit record lacks project ID")
                continue
            if target_type in ("project", "project_draft") and target_id is not None:
                root = roots.get(str(target_id))
                if root in accepted_roots:
                    target_id = root
            detail = {"sourceTable": table, "legacyActorId": str(row["actor_id"]),
                      "legacyActorName": row.get("actor_name"),
                      "legacyTargetId": str(row.get("target_id") if table == "admin_action_logs" else row.get("project_id")) if (row.get("target_id") if table == "admin_action_logs" else row.get("project_id")) is not None else None}
            metadata = table == "project_metadata_audit_logs" or row.get("action") == "compatibility_updated"
            if metadata:
                payload = json.loads(row["detail"]) if table == "admin_action_logs" and row.get("detail") else row
                detail["beforeValue"] = payload.get("beforeValue", payload.get("before_value"))
                detail["afterValue"] = payload.get("afterValue", payload.get("after_value"))
            else:
                detail["legacyDetail"] = row.get("detail")
            tables["audit_events"].append({
                "id": identifier("legacy-audit", table, row["id"]),
                "action": "project.patch" if metadata else "legacy." + str(row["action"]),
                "target_type": target_type, "target_id": target_id, "actor_id": actor,
                "detail": json.dumps(detail, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
                "created_at": row["created_at"],
            })

    enabled_curators = {str(row["user_id"]) for row in source.get("devteam_curators", []) if row.get("enabled") == 1}
    authorized_curators = {str(row["user_id"]) for row in source.get("super_admins", [])}
    authorized_curators.update(str(row["id"]) for row in source.get("users", []) if row.get("is_admin") == 1)
    legacy_projects = {str(row["id"]): row for row in source.get("projects", [])}
    recommendations = defaultdict(list)
    for row in source.get("devteam_recommendations", []):
        curator = row.get("curator_id")
        project = row.get("project_id")
        root = roots.get(str(project)) if project is not None else None
        if root in excluded_roots:
            omit("devteam_recommendations", row, "recommendation belongs to excluded project")
            continue
        if curator is None or str(curator) not in users or root not in accepted_roots:
            issue("devteam_recommendations", row, "missing mapped project or curator")
            continue
        project_row = legacy_projects.get(str(project), {})
        if (str(curator) not in enabled_curators or str(curator) not in authorized_curators
                or project_row.get("status") != "approved" or project_row.get("is_published") != 1
                or project_row.get("visibility") != 1):
            issue("devteam_recommendations", row, "legacy recommendation visibility cannot be preserved by the target feed")
            continue
        if any(row.get(field) is None for field in ("comment_text", "reaction_label", "created_at", "updated_at")) or not row["created_at"] or not row["updated_at"]:
            issue("devteam_recommendations", row, "recommendation lacks required content or timestamps")
            continue
        recommendations[(str(curator), root)].append(row)
    for (curator, root), rows in sorted(recommendations.items()):
        if len(rows) != 1:
            for row in rows:
                issue("devteam_recommendations", row, "multiple legacy recommendations collapse to the same curator and project")
            continue
        row = rows[0]
        target = next(project for project in tables["projects"] if project["id"] == root)
        published_id = target.get("published_version_id")
        version = next((item for item in tables["project_versions"] if item["id"] == published_id), None)
        if (version is None or not target.get("published_at") or not version.get("created_at")
                or target["published_at"] > row["created_at"] or version["created_at"] > row["created_at"]):
            omit("devteam_recommendations", row, "recommendation current version attribution unavailable; source backup retained")
            continue
        tables["recommendations"].append({
            "id": identifier("legacy-recommendation", curator, root),
            "curator_id": curator, "project_id": root, "project_version_id": published_id, "comment": row["comment_text"],
            "created_at": row["created_at"], "updated_at": row["updated_at"],
        })

    for row in source.get("discovery_feature_history", []):
        omit("discovery_feature_history", row,
             "legacy daily feature history excluded from snapshot")

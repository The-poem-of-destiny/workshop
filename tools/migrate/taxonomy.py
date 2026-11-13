#!/usr/bin/env python3
"""Local, source-pinned taxonomy review and lossless current-snapshot candidates.

This module never accesses credentials or a network. It only reads original R2
backup bytes when explicit legacy provenance is supplied; it never accesses R2.
Review files contain private source values. Building always creates a new candidate, including for an
already-current snapshot; it never updates its source in place.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys

PROJECT_TYPES = ("系统核心", "角色", "内容扩展", "玩法", "事件", "体验优化")
REVIEW_FORMAT = "workshop-taxonomy-review-v1"
CANDIDATE_FORMAT = "workshop-taxonomy-candidate-v2"
DERIVED = {"project_search", "project_search_short", "project_search_tags"}
INTERNAL = {"d1_migrations", "sqlite_sequence", "_cf_KV"}
OBSOLETE = {"extension_type", "project_types", "author_note"}
DECISIONS = {"projectType", "includedTypes", "reviewed", "tagsAcknowledged", "targetTags", "tagChangeReason"}
# Match JavaScript String.prototype.trim(), not Python's broader str.strip().
JS_TRIM_WHITESPACE = ("\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
                      "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
                      "\u2028\u2029\u202f\u205f\u3000\ufeff")


def stable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(stable(value).encode("utf-8")).hexdigest()


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def private_write(path, raw):
    path = Path(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(raw)


def json_write(path, value):
    private_write(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))


def cell(value):
    if value is None:
        return ["null"]
    if isinstance(value, bytes):
        return ["blob", value.hex()]
    if isinstance(value, int):
        return ["integer", str(value)]
    if isinstance(value, float):
        return ["real", repr(value)]
    if isinstance(value, str):
        return ["text", value]
    raise ValueError("unsupported SQLite value")


def row_digest(row):
    return digest({key: cell(value) for key, value in row.items()})


def table_names(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")}


def columns(db, name):
    return [row[1] for row in db.execute("PRAGMA table_xinfo(" + quote(name) + ")") if row[6] != 1]


def logical_tables(db):
    shadows = {name + "_" + suffix for name in ("project_search", "project_search_short")
               for suffix in ("config", "content", "data", "docsize", "idx")}
    return table_names(db) - DERIVED - INTERNAL - shadows


@contextmanager
def snapshot(path):
    """Pin complete local bytes; never open a SQLite source for writing."""
    path = Path(path).resolve()
    source_hash = file_hash(path)
    raw_header = path.open("rb")
    with raw_header:
        sqlite_file = raw_header.read(16) == b"SQLite format 3\x00"
    if sqlite_file:
        if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
            raise ValueError("source must be a closed, checkpointed SQLite snapshot without sidecars")
        db = sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True)
    else:
        db = sqlite3.connect(":memory:")
        db.set_authorizer(lambda action, *_: sqlite3.SQLITE_DENY
                          if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH) else sqlite3.SQLITE_OK)
        db.executescript(path.read_text(encoding="utf-8"))
        db.set_authorizer(None)
        # sqlite3.iterdump encodes virtual tables via writable_schema. Reload its
        # restored schema before any FTS-backed table/view is queried.
        db.execute("PRAGMA writable_schema=OFF")
        version = db.execute("PRAGMA schema_version").fetchone()[0]
        db.execute("PRAGMA schema_version=" + str(version + 1))
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        yield db, source_hash
    finally:
        db.close()
        if file_hash(path) != source_hash:
            raise ValueError("source changed while reading; discard the candidate and prepare a fresh review")


def string_array(raw, field):
    if raw in (None, ""):
        return []
    value = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ValueError("invalid " + field + "; a separate explicit source-data repair is required")
    return value


def legacy_tag_arrays(row):
    """Keep each original array separate before the cross-field merge."""
    for field in ("tags", "custom_tags", "facets"):
        raw = row.get(field)
        if field == "facets":
            groups = json.loads(raw) if raw not in (None, "") else {}
            if not isinstance(groups, dict):
                raise ValueError("invalid source facets")
            for group in groups.values():
                yield string_array(group, "facet values")
        else:
            yield string_array(raw, field)


def tag_accounting(row, kind):
    source = {field: row[field] for field in ("tags", "custom_tags", "facets", "search_tags") if field in row}
    if kind == "legacy":
        arrays = list(legacy_tag_arrays(row))
        duplicate_values = any(len(values) != len(set(values)) for values in arrays)
        tags = list(dict.fromkeys(value for values in arrays for value in values))
    else:
        raw = row.get("tags", row.get("search_tags"))
        tags = string_array(raw, "tags")
        duplicate_values = len(tags) != len(set(tags))
    issues = []
    if not tags:
        issues.append("empty_tags")
    if any(not value.strip(JS_TRIM_WHITESPACE) for value in tags):
        issues.append("blank_tag_values_preserved")
    if duplicate_values:
        issues.append("duplicate_tag_values_preserved")
    if len(tags) > 20:
        issues.append("historical_tags_above_editor_limit_preserved")
    if any(value != value.strip(JS_TRIM_WHITESPACE) or len(value) > 100 for value in tags):
        issues.append("historical_tags_outside_target_value_contract")
    return {"source": source, "values": tags, "issues": issues}


def valid_classification(primary, included):
    return (primary in PROJECT_TYPES and isinstance(included, list)
            and all(isinstance(value, str) and value in PROJECT_TYPES
                    and value not in ("系统核心", primary) for value in included)
            and len(included) == len(set(included)))


def valid_tags(tags):
    return (isinstance(tags, list) and len(tags) <= 20
            and all(isinstance(value, str) and value == value.strip(JS_TRIM_WHITESPACE)
                    and 0 < len(value) <= 100 for value in tags)
            and len(tags) == len(set(tags)))


def review_records(db, kind):
    names = table_names(db)
    table = {"current": "project_versions", "preview": "project_revisions", "legacy": "projects"}[kind]
    if table not in names or (kind != "legacy" and "projects" not in names):
        raise ValueError("source does not have the selected snapshot shape")
    parents = ({str(row["id"]): dict(row) for row in db.execute("SELECT * FROM projects")}
               if kind != "legacy" else {})
    published_parents = {str(row.get("published_revision_id")): row for row in parents.values()}
    result = []
    for value in db.execute("SELECT * FROM " + quote(table) + " ORDER BY id"):
        row = dict(value)
        source = dict(row)
        parent = parents.get(str(row.get("project_id")), published_parents.get(str(row["id"]), {}))
        for field in ("project_type", "project_types", "extension_type", "included_types"):
            if field not in source and field in parent:
                source[field] = parent[field]
        if kind == "preview" and source.get("tags") is None:
            source["tags"] = parent.get("search_tags")
        old = source.get("project_type")
        primary = "系统核心" if old == "系统" else old if old in PROJECT_TYPES else None
        reasons = []
        if primary is None:
            reasons.append("ambiguous_extension_or_unknown_primary")
        if source.get("project_types") not in (None, "", "[]"):
            reasons.append("obsolete_multi_primary_requires_explicit_selection")
        if source.get("extension_type") not in (None, ""):
            reasons.append("obsolete_extension_subtype_requires_accounting")
        try:
            included = string_array(source.get("included_types"), "included_types")
        except (TypeError, ValueError):
            included = []
            reasons.append("invalid_existing_secondary_categories")
        if not valid_classification(primary, included):
            if included:
                reasons.append("invalid_existing_secondary_categories")
            included = []
        tags = tag_accounting(source, kind)
        result.append({
            "table": table, "id": str(row["id"]), "sourceRowSha256": row_digest(row),
            "context": {"projectId": row.get("project_id", row["id"]),
                        "title": row.get("title", row.get("name")), "description": row.get("description")},
            "sourceTaxonomy": {field: source[field] for field in
                               ("project_type", "project_types", "extension_type", "included_types") if field in source},
            "tags": tags, "required": sorted(set(reasons)), "projectType": primary,
            "includedTypes": included, "reviewed": False,
            "tagsAcknowledged": False,
            "targetTags": (None if kind == "legacy" and "duplicate_tag_values_preserved" in tags["issues"]
                           else tags["values"]), "tagChangeReason": "",
        })
    return result


def removed_fields(db):
    result = []
    for table in sorted(table_names(db) & {"projects", "project_versions"}):
        fields = sorted(set(columns(db, table)) & (OBSOLETE | ({"project_type", "included_types"} if table == "projects" else set())))
        if fields:
            for row in db.execute("SELECT * FROM " + quote(table) + " ORDER BY id"):
                result.append({"table": table, "id": str(row["id"]),
                               "values": {field: row[field] for field in fields}})
    return result


def review_document(db, source_hash, kind):
    records = review_records(db, kind)
    return {"format": REVIEW_FORMAT, "source": {"sha256": source_hash, "kind": kind},
            "projectTypes": list(PROJECT_TYPES), "records": records, "removedFields": removed_fields(db)}


def reject_duplicate_json_keys(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value


def resolve_review(db, source_hash, review, kind):
    expected = review_document(db, source_hash, kind)
    if not isinstance(review, dict) or set(review) != set(expected):
        raise ValueError("invalid taxonomy review structure")
    if any(review[key] != expected[key] for key in expected if key != "records"):
        raise ValueError("stale or altered taxonomy review source/accounting")
    records = review.get("records")
    if not isinstance(records, list) or len(records) != len(expected["records"]):
        raise ValueError("taxonomy review must account for every source record")
    resolved = {}
    for actual, baseline in zip(records, expected["records"]):
        if (not isinstance(actual, dict) or set(actual) != set(baseline)
                or any(actual[key] != baseline[key] for key in baseline if key not in DECISIONS)):
            raise ValueError("stale, reordered or altered taxonomy review record")
        if actual["reviewed"] is not True or actual["tagsAcknowledged"] is not True:
            raise ValueError("unresolved taxonomy classification or tag accounting")
        if not valid_classification(actual["projectType"], actual["includedTypes"]):
            raise ValueError("invalid reviewed primary/included categories")
        if not valid_tags(actual["targetTags"]):
            raise ValueError("reviewed tags must satisfy the target max20 unique nonempty trimmed max100 contract")
        if not isinstance(actual["tagChangeReason"], str):
            raise ValueError("invalid tag change explanation")
        if (actual["targetTags"] != baseline["tags"]["values"]
                or "duplicate_tag_values_preserved" in baseline["tags"]["issues"]) and not actual["tagChangeReason"].strip():
            raise ValueError("changed tags require an explicit review explanation; source values remain in private accounting")
        key = actual["id"]
        if key in resolved:
            raise ValueError("duplicate source classification identity")
        raw_tags = baseline["tags"]["source"].get("tags")
        target_tags = (raw_tags if kind == "current" and isinstance(raw_tags, str)
                       and string_array(raw_tags, "tags") == actual["targetTags"] and raw_tags != ""
                       else stable(actual["targetTags"]))
        raw_included = baseline["sourceTaxonomy"].get("included_types")
        target_included = (raw_included if kind == "current" and isinstance(raw_included, str)
                           and string_array(raw_included, "included_types") == actual["includedTypes"] and raw_included != ""
                           else stable(actual["includedTypes"]))
        resolved[key] = {"project_type": actual["projectType"],
                         "included_types": target_included, "tags": target_tags}
    return resolved


def read_review(path):
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_json_keys)


def load_review(source, review_path, kind):
    review = read_review(review_path)
    with snapshot(source) as (db, source_hash):
        return resolve_review(db, source_hash, review, kind)


def prepare_review(source, kind, output):
    if Path(source).resolve() == Path(output).resolve():
        raise ValueError("review must not overwrite its source")
    with snapshot(source) as (db, source_hash):
        value = review_document(db, source_hash, kind)
    json_write(output, value)
    return {"ok": True, "records": len(value["records"]), "unresolved": sum(
        not row["reviewed"] or not row["tagsAcknowledged"] for row in value["records"])}


def canonical(migrations):
    validator = module("taxonomy_validator", "full-validate.py")
    db = sqlite3.connect(":memory:")
    files = validator.migration_files(Path(migrations))
    for path in files:
        db.executescript(path.read_text(encoding="utf-8"))
    return db, [{"name": path.name, "sha256": file_hash(path)} for path in files]


def dropped_columns(table, source_columns, target_columns):
    extra = set(source_columns) - set(target_columns)
    permitted = (OBSOLETE | {"project_type", "included_types"} if table == "projects"
                 else OBSOLETE if table == "project_versions" else set())
    if extra - permitted:
        raise ValueError("unaccounted source columns in " + table + ": " + ",".join(sorted(extra - permitted)))
    added = set(target_columns) - set(source_columns)
    if added - ({"project_type", "included_types"} if table == "project_versions" else set()):
        raise ValueError("unexpected target-only columns in " + table + ": " + ",".join(sorted(added)))
    return extra


def check_shapes(source, target):
    source_names, target_names = logical_tables(source), logical_tables(target)
    if source_names - target_names:
        raise ValueError("unaccounted source tables: " + ",".join(sorted(source_names - target_names)))
    for table in sorted(source_names):
        dropped_columns(table, columns(source, table), columns(target, table))
    version_columns = set(columns(target, "project_versions"))
    if not {"project_type", "included_types"} <= version_columns or version_columns & OBSOLETE:
        raise ValueError("target migrations do not define the final six-category schema")
    return source_names, target_names


def legacy_provenance_inputs(provenance, migrations, planner):
    result, sources = [], set()
    for paths in provenance:
        if len(paths) != 3:
            raise ValueError("legacy provenance requires preparation, original SQL and manifest")
        preparation_path, source_path, manifest_path = (Path(path).resolve(strict=True) for path in paths)
        for path in (preparation_path, source_path, manifest_path):
            if any(Path(str(path) + suffix).exists() for suffix in ("-wal", "-shm", "-journal")):
                raise ValueError("legacy provenance inputs must be closed snapshots without sidecars")
        with source_path.open("rb") as stream:
            if stream.read(16) == b"SQLite format 3\x00":
                raise ValueError("legacy provenance requires the original SQL dump, not a current SQLite snapshot")
        pins = planner.inputs(preparation_path, source_path, manifest_path, migrations)
        source_hash = pins["source"]["sha256"]
        if source_hash in sources:
            raise ValueError("duplicate or conflicting legacy source provenance")
        sources.add(source_hash)
        result.append(pins)
    return sorted(result, key=lambda item: (item["source"]["sha256"], item["preparation"]["sha256"]))


def legacy_integrity_evidence(source, migrations, provenance, planner):
    """Grant only byte-reconciled imported exceptions matching this current snapshot."""
    omissions, owners = [], {}
    for pins in provenance:
        preparation_path = Path(pins["preparation"]["path"])
        data = planner.loader.preparation(preparation_path)
        if not planner.loader.source_reconcile(data, Path(pins["source"]["path"]),
                                               Path(pins["manifest"]["path"]), migrations=Path(migrations))["ok"]:
            raise ValueError("legacy provenance does not reconcile to original source bytes")
        if not planner.validator.validate(data, Path(migrations))["ok"]:
            raise ValueError("legacy provenance fails canonical application validation")
        expected, _ = canonical(migrations)
        try:
            expected.row_factory = sqlite3.Row
            planner.loader.assert_source_columns(expected)
            expected.execute("PRAGMA foreign_keys=OFF")
            for name, in expected.execute("SELECT name FROM sqlite_schema WHERE type='trigger'").fetchall():
                expected.execute("DROP TRIGGER " + quote(name))
            # The independent source check authenticated every canonical version
            # and asset column; materialize only their real storage affinities/defaults.
            for table in ("projects", "project_versions", "assets"):
                for row in data["tables"].get(table, []):
                    keys = sorted(row)
                    expected.execute("INSERT INTO " + quote(table) + " (" + ",".join(map(quote, keys))
                                     + ") VALUES (" + ",".join("?" for _ in keys) + ")", [row[key] for key in keys])
            version_keys = sorted(set(columns(expected, "project_versions")) - {"project_type", "included_types", "tags"})
            asset_keys = sorted(columns(expected, "assets"))
            project_keys = ("id", "author_id", "created_at", "published_version_id", "published_at", "published_updated_at")
            for item in data.get("omissions", []):
                reason = item.get("reason", "")
                if (item.get("table") != "projects" or not isinstance(item.get("source"), dict)
                        or (reason != "content index unavailable: duplicate entry keys"
                            and not reason.startswith("invalid content asset omitted: "))):
                    continue
                identity = planner.loader.version_id(str(item["source"]["id"]))
                original = expected.execute("SELECT * FROM project_versions WHERE id=?", (identity,)).fetchone()
                current = source.execute("SELECT v.* FROM project_versions v JOIN projects p ON p.published_version_id=v.id "
                                         "WHERE v.id=? AND v.entry_index IS NULL", (identity,)).fetchone()
                if original is None or current is None:
                    continue
                original_project = expected.execute("SELECT * FROM projects WHERE id=? AND published_version_id=?",
                                                    (original["project_id"], identity)).fetchone()
                if original_project is None:
                    continue
                current_project = source.execute("SELECT * FROM projects WHERE id=? AND published_version_id=?",
                                                 (current["project_id"], identity)).fetchone()
                if (current_project is None
                        or any(cell(original[key]) != cell(current[key]) for key in version_keys)
                        or any(cell(original_project[key]) != cell(current_project[key]) for key in project_keys)):
                    raise ValueError("imported exception revision or published project identity changed")
                original_assets = Counter(stable([cell(row[key]) for key in asset_keys]) for row in
                                          expected.execute("SELECT * FROM assets WHERE version_id=?", (identity,)))
                current_assets = Counter(stable([cell(row[key]) for key in asset_keys]) for row in
                                         source.execute("SELECT * FROM assets WHERE version_id=?", (identity,)))
                if original_assets != current_assets:
                    raise ValueError("imported exception asset rows changed")
                if reason.startswith("invalid content asset omitted: ") and (
                        original_project["visibility"] != "private" or current_project["visibility"] != "private"):
                    continue
                owner = pins["source"]["sha256"]
                if identity in owners and owners[identity] != owner:
                    raise ValueError("conflicting legacy exception provenance")
                owners[identity] = owner
                omissions.append(item)
        finally:
            expected.close()
    return {"omissions": sorted(omissions, key=stable)}


def pinned_inputs(source_hash, review_path, migrations, provenance):
    return {"format": CANDIDATE_FORMAT, "sourceSha256": source_hash,
            "reviewSha256": file_hash(review_path), "migrations": migrations,
            "legacyProvenance": provenance,
            "helpers": [{"name": name, "sha256": file_hash(Path(__file__).with_name(name))}
                        for name in ("taxonomy.py", "full-validate.py", "multiday-plan.py", "d1-data.py", "full-load.py")]}


def build(source_path, review_path, migrations, output, legacy_provenance=()):
    output = Path(output)
    review = read_review(review_path)
    target, migration_pins = canonical(migrations)
    planner = module("taxonomy_planner", "multiday-plan.py")
    try:
        with snapshot(source_path) as (source, source_hash):
            decisions = resolve_review(source, source_hash, review, "current")
            source_names, target_names = check_shapes(source, target)
            provenance = legacy_provenance_inputs(legacy_provenance, migrations, planner)
            frozen = pinned_inputs(source_hash, review_path, migration_pins, provenance)
            integrity_evidence = legacy_integrity_evidence(source, migrations, provenance, planner)
            schema = planner.schema(target)
            triggers = [(row["name"], row["sql"]) for row in schema if row["type"] == "trigger"]
            search = dict(triggers).get("project_search_update")
            if not search:
                raise ValueError("canonical search trigger is missing")
            for name, _ in triggers:
                target.execute("DROP TRIGGER " + quote(name))
            for table in sorted(target_names | DERIVED):
                target.execute("DELETE FROM " + quote(table))
            for table in sorted(source_names):
                target_columns = columns(target, table)
                for value in source.execute("SELECT * FROM " + quote(table)):
                    row = dict(value)
                    if table == "project_versions":
                        row.update(decisions[str(row["id"])])
                    values = [row[key] for key in target_columns]
                    target.execute("INSERT INTO " + quote(table) + " (" + ",".join(map(quote, target_columns))
                                   + ") VALUES (" + ",".join("?" for _ in values) + ")", values)
            for row in target.execute("SELECT id FROM projects ORDER BY id").fetchall():
                for sql in planner.canonical_search_statements(search, row[0], set(columns(target, "projects"))):
                    target.execute(sql)
            for _, sql in triggers:
                target.execute(sql)
            target.commit()
            integrity = planner.validator.application_integrity(target, integrity_evidence)
            if integrity["failures"] or planner.validator.stored_size_failures(target):
                raise ValueError("candidate application integrity or D1 stored-row bounds failed")
            if planner.schema(target) != schema:
                raise ValueError("candidate canonical schema changed during copying")
            if pinned_inputs(source_hash, review_path, migration_pins,
                             legacy_provenance_inputs(legacy_provenance, migrations, planner)) != frozen:
                raise ValueError("migration inputs changed during build")
            output.mkdir(mode=0o700, parents=False, exist_ok=False)
            path = output / "expected.sqlite"
            private_write(path, b"")
            destination = sqlite3.connect(path)
            try:
                target.backup(destination)
            finally:
                destination.close()
            json_write(output / "review.json", review)
            json_write(output / "candidate.json", frozen)
        return {"ok": True, "candidate": str(output / "expected.sqlite"), "sourceTables": len(source_names),
                "versions": len(decisions), "verified": False,
                "next": "run offline.py taxonomy verify against the original source and edited review"}
    finally:
        target.close()


def row_counts(db, table, keys):
    return Counter(stable([cell(row[key]) for key in keys])
                   for row in db.execute("SELECT * FROM " + quote(table)))


def independent_rows(source, candidate, decisions):
    """Compare source fields directly, without constructing transformed rows."""
    source_names, target_names = check_shapes(source, candidate)
    evidence = {}
    for table in sorted(target_names):
        if table not in source_names:
            if candidate.execute("SELECT count(*) FROM " + quote(table)).fetchone()[0]:
                raise ValueError("candidate invented rows in " + table)
            evidence[table] = {"rows": 0, "nonTaxonomySha256": digest([])}
            continue
        excluded = (set(columns(source, table)) - set(columns(candidate, table)))
        if table == "project_versions":
            excluded.update({"project_type", "included_types", "tags"})
        keys = sorted(set(columns(source, table)) - excluded)
        expected = row_counts(source, table, keys)
        actual = row_counts(candidate, table, keys)
        if expected != actual:
            raise ValueError("non-taxonomy row/field difference in " + table)
        if table == "project_versions":
            actual_types = {str(row[0]): (row[1], row[2], row[3]) for row in candidate.execute(
                "SELECT id,project_type,included_types,tags FROM project_versions")}
            expected_types = {key: (row["project_type"], row["included_types"], row["tags"]) for key, row in decisions.items()}
            if actual_types != expected_types:
                raise ValueError("reviewed taxonomy/tags differ from candidate")
        evidence[table] = {"rows": sum(expected.values()),
                           "nonTaxonomySha256": digest(sorted(expected.items()))}
    return evidence


def verify(source_path, review_path, migrations, candidate_dir, report_path=None, legacy_provenance=()):
    candidate_dir = Path(candidate_dir)
    review = read_review(review_path)
    evidence = read_review(candidate_dir / "candidate.json")
    canonical_db, migration_pins = canonical(migrations)
    planner = module("taxonomy_verify_planner", "multiday-plan.py")
    validator = module("taxonomy_verify_validator", "full-validate.py")
    candidate_memory = sqlite3.connect(":memory:")
    try:
        with snapshot(source_path) as (source, source_hash), snapshot(candidate_dir / "expected.sqlite") as (candidate, candidate_hash):
            decisions = resolve_review(source, source_hash, review, "current")
            provenance = legacy_provenance_inputs(legacy_provenance, migrations, planner)
            if evidence != pinned_inputs(source_hash, review_path, migration_pins, provenance):
                raise ValueError("stale candidate source/review/migrations/helpers")
            if read_review(candidate_dir / "review.json") != review:
                raise ValueError("sealed review differs from reviewed input")
            if planner.schema(candidate) != planner.schema(canonical_db):
                raise ValueError("candidate schema differs from complete canonical migrations")
            tables = independent_rows(source, candidate, decisions)
            if candidate.execute("PRAGMA foreign_key_check").fetchall():
                raise ValueError("candidate foreign key check failed")
            if [row[0] for row in candidate.execute("PRAGMA integrity_check")] != ["ok"]:
                raise ValueError("candidate integrity check failed")
            integrity_evidence = legacy_integrity_evidence(source, migrations, provenance, planner)
            integrity = validator.application_integrity(candidate, integrity_evidence)
            if integrity["failures"] or validator.stored_size_failures(candidate):
                raise ValueError("candidate application integrity or D1 stored-row bounds failed")
            # FTS integrity checks write to an in-memory clone, never the candidate.
            candidate.backup(candidate_memory)
            search = canonical_db.execute("SELECT sql FROM sqlite_schema WHERE name='project_search_update'").fetchone()[0]
            planner.expected_search(candidate_memory, {}, search)
            if pinned_inputs(source_hash, review_path, migration_pins,
                             legacy_provenance_inputs(legacy_provenance, migrations, planner)) != evidence:
                raise ValueError("migration inputs changed during verification")
            result = {"format": "workshop-taxonomy-verification-v1", "ok": True,
                      "sourceSha256": source_hash, "candidateSha256": candidate_hash,
                      "reviewSha256": file_hash(review_path), "tables": tables,
                      "removedFieldsSha256": digest(review["removedFields"]),
                      "removedFieldRecords": len(review["removedFields"]),
                      "reviewedTagExceptions": sum(bool(row["tags"]["issues"]) for row in review["records"]),
                      "reviewedTagChanges": sum(row["targetTags"] != row["tags"]["values"] for row in review["records"]),
                      "taxonomyChangesSha256": digest([{ "id": row["id"], "source": row["sourceTaxonomy"],
                          "projectType": row["projectType"], "includedTypes": row["includedTypes"],
                          "sourceTags": row["tags"], "targetTags": row["targetTags"],
                          "tagChangeReason": row["tagChangeReason"]} for row in review["records"]]),
                      "nonTaxonomyScope": "all logical source rows/fields except reviewed primary/included/tags and explicitly removed obsolete fields",
                      "foreignKeys": True, "applicationIntegrity": True, "canonicalSearch": True,
                      "acceptedImportedExceptions": integrity["accepted_exceptions"],
                      "legacyProvenanceSha256": digest(provenance), "legacySources": len(provenance),
                      "sourceUnchanged": True,
                      "objects": ("references preserved; supplied local legacy backup bytes independently checked; no remote R2 access"
                                  if provenance else "references preserved; no object bytes accessed")}
        if report_path:
            json_write(report_path, result)
        return result
    finally:
        canonical_db.close()
        candidate_memory.close()


def configure(parser):
    commands = parser.add_subparsers(dest="taxonomy_mode", required=True)
    prepare = commands.add_parser("prepare-review", help="create private editable source-pinned decisions")
    prepare.add_argument("--source", type=Path, required=True)
    prepare.add_argument("--source-kind", choices=("current", "legacy", "preview"), default="current")
    prepare.add_argument("--output", type=Path, required=True)
    for name in ("build", "verify"):
        command = commands.add_parser(name, help="create a local candidate" if name == "build" else "independently verify a local candidate")
        command.add_argument("--source", type=Path, required=True)
        command.add_argument("--review", type=Path, required=True)
        command.add_argument("--migrations", type=Path, required=True)
        command.add_argument("--" + ("output" if name == "build" else "candidate"), type=Path, required=True)
        command.add_argument("--legacy-provenance", type=Path, nargs=3, action="append", default=[],
                             metavar=("PREPARATION", "SOURCE_SQL", "MANIFEST"),
                             help="independently validate imported content exceptions against one local legacy backup (repeatable)")
        if name == "verify":
            command.add_argument("--report", type=Path)
    resolve = commands.add_parser("resolve", help="resolve reviewed classifications for the local preview loader")
    resolve.add_argument("--source", type=Path, required=True)
    resolve.add_argument("--review", type=Path, required=True)
    resolve.add_argument("--source-kind", choices=("legacy", "preview"), required=True)


def run(args):
    try:
        if args.taxonomy_mode == "prepare-review":
            result = prepare_review(args.source, args.source_kind, args.output)
        elif args.taxonomy_mode == "build":
            result = build(args.source, args.review, args.migrations, args.output, args.legacy_provenance)
        elif args.taxonomy_mode == "verify":
            result = verify(args.source, args.review, args.migrations, args.candidate, args.report, args.legacy_provenance)
        else:
            result = {"ok": True, "classifications": load_review(args.source, args.review, args.source_kind)}
    except (OSError, ValueError, TypeError, KeyError, sqlite3.Error):
        # Source titles, tags, notes, and record identities must not reach logs.
        print(json.dumps({"ok": False, "error": "unresolved_stale_or_invalid_taxonomy_inputs"}))
        return 1
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    configure(parser)
    return run(parser.parse_args())


if __name__ == "__main__":
    sys.exit(main())

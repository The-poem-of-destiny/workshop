import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

// Regression guard for the two index additions of migrations 0037/0038.
//
// Both are planner decisions, not behavioural ones, so a functional assertion
// cannot catch their removal:
//
//   * the original-conflict validator must seek per requested id instead of
//     scanning every item of a reference version. Measured on the 2026-11-01
//     production workload the scan form read 556 rows per call for ~5 returned
//     rows, 35% of the account's daily D1 read quota.
//   * the DELETE FROM projects cascade must reach project_metric_daily through
//     the project_id index. Without it the same cascade visited ~57,000 rows on
//     the 2026-10-28 snapshot; with it ~10,500.
//
// The validator SQL is read back from the Worker source so a rewrite the index
// no longer serves fails here instead of silently returning to the scan plan.

const [schema, validatorSource] = await Promise.all([
  readFile(new URL('../schema.sql', import.meta.url), 'utf8'),
  readFile(new URL('../src/utils/character-reference.ts', import.meta.url), 'utf8'),
]);

const itemLookupMigration = await readFile(
  new URL('../migrations/0037_character_reference_item_id_lookup_index.sql', import.meta.url),
  'utf8',
);
const cascadeMigration = await readFile(
  new URL('../migrations/0038_project_cascade_delete_indexes.sql', import.meta.url),
  'utf8',
);

// schema.sql must stay convergent with the migrations, because the local test
// database is built from schema.sql while production is built from migrations.
for (const indexName of [
  'idx_character_reference_items_version_item',
  'idx_project_metric_daily_project',
  'idx_project_daily_rankings_project',
]) {
  assert.match(schema, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}\\b`), `schema.sql is missing ${indexName}`);
}

const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
db.exec(schema);

// Simulate production before the migrations: the indexes exist in schema.sql
// only because it must stay convergent with the incremental upgrade path, so
// drop them and let the migrations put them back.
for (const indexName of [
  'idx_character_reference_items_version_item',
  'idx_project_metric_daily_project',
  'idx_project_daily_rankings_project',
]) {
  db.exec(`DROP INDEX IF EXISTS ${indexName}`);
}
db.exec(itemLookupMigration);
db.exec(cascadeMigration);

function plan(sql, ...params) {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map(row => String(row.detail))
    .join('\n');
}

const validatorSqlMatch = validatorSource.match(
  /`(SELECT id, kind, source_key, display_name\s+FROM character_reference_items[\s\S]*?)`/,
);
assert.ok(validatorSqlMatch, 'validator SQL must stay extractable from src/utils/character-reference.ts');
const validatorSql = validatorSqlMatch[1];

const listSqlMatch = validatorSource.match(
  /`(SELECT id, reference_version_id, kind, source_key, display_name\s+FROM character_reference_items[\s\S]*?)`/,
);
assert.ok(listSqlMatch, 'version item list SQL must stay extractable');
const listSql = listSqlMatch[1];

const versionId = 'refver-plan-check';
const requestedIds = ['item-0', 'item-1', 'item-2'];

const validatorPlan = plan(validatorSql, versionId, JSON.stringify(requestedIds));
assert.match(
  validatorPlan,
  /SEARCH character_reference_items USING (?:COVERING )?INDEX idx_character_reference_items_version_item \(reference_version_id=\? AND id=\?\)/,
  `validator must seek per requested id, got:\n${validatorPlan}`,
);
assert.doesNotMatch(
  validatorPlan,
  /USING INDEX idx_character_reference_items_version_kind/,
  'validator must not fall back to the version+kind scan',
);

// The picker list keeps its own ordering index; the new lookup index must not
// displace it, and it must not be extended into a covering variant that would
// make the planner prefer it for the validator (measured as a net regression).
const listPlan = plan(listSql, versionId);
assert.match(
  listPlan,
  /SEARCH character_reference_items USING INDEX idx_character_reference_items_version_kind \(reference_version_id=\?\)/,
  `version item list must keep using the version+kind index, got:\n${listPlan}`,
);

const itemIndexColumns = db
  .prepare('PRAGMA index_info(idx_character_reference_items_version_item)')
  .all()
  .map(row => `${row.name}${row.coll ? ` COLLATE ${row.coll}` : ''}`);
assert.deepEqual(itemIndexColumns, ['reference_version_id', 'id']);

// Foreign-key cascade lookups are planned per child table. A child whose only
// index leads with the ranking day scans in full for every deleted project.
for (const [table, indexName] of [
  ['project_metric_daily', 'idx_project_metric_daily_project'],
  ['project_daily_rankings', 'idx_project_daily_rankings_project'],
]) {
  const childPlan = plan(`SELECT 1 FROM ${table} WHERE project_id = ?`, 'project-1');
  assert.match(
    childPlan,
    new RegExp(`SEARCH ${table} USING (?:COVERING )?INDEX ${indexName} \\(project_id=\\?\\)`),
    `${table} cascade lookup must use ${indexName}, got:\n${childPlan}`,
  );
}

// Behavioural floor: the indexes must not change what the cascade deletes.
db.prepare("INSERT INTO users (id, username, global_name) VALUES ('author', 'author', '作者')").run();
db.prepare(`INSERT INTO projects (id, name, author_id, author_name, status, is_published, visibility)
            VALUES ('project-1', '计划校验', 'author', '作者', 'approved', 1, 1)`).run();
db.prepare(`INSERT INTO project_metric_daily (day_key, project_id, downloads) VALUES ('2026-11-01', 'project-1', 3)`).run();
db.prepare(`INSERT INTO project_daily_rankings
              (ranking_day, project_id, project_type, discover_rank, discover_type_rank)
            VALUES ('2026-11-01', 'project-1', '角色', 1, 1)`).run();

db.prepare("DELETE FROM projects WHERE id = ?").run('project-1');
for (const table of ['project_metric_daily', 'project_daily_rankings']) {
  assert.equal(
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
    0,
    `${table} rows must still cascade away`,
  );
}

db.close();
console.log('d1 index usage smoke: ok');

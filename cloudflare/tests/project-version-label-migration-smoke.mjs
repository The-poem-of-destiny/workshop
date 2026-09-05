import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT DEFAULT '1.0.0'
  );
`);

const migration = await readFile(new URL('../migrations/0006_project_version_label.sql', import.meta.url), 'utf8');
db.exec(migration);

const columns = db.prepare('PRAGMA table_info(projects)').all();
assert.equal(columns.some(column => column.name === 'version_label'), true);

db.prepare('INSERT INTO projects (id, name, version, version_label) VALUES (?, ?, ?, ?)').run(
  'demo',
  'Demo',
  '1.0.0',
  '2026夏季版',
);
const row = db.prepare('SELECT version, version_label FROM projects WHERE id = ?').get('demo');
assert.equal(row.version, '1.0.0');
assert.equal(row.version_label, '2026夏季版');

console.log('project version label migration smoke: ok');

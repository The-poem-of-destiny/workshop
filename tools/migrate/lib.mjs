import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TABLES = [
  'users', 'projects', 'project_revisions', 'assets', 'submissions', 'reviews',
  'project_likes', 'project_subscriptions', 'project_ratings', 'project_metrics_daily',
  'ranking_runs', 'ranking_entries', 'discovery_exposures', 'recommendations',
  'site_settings', 'reference_sets', 'reference_versions', 'reference_items', 'audit_events'
];
const aliases = new Map([
  ['user', 'users'], ['users', 'users'], ['project', 'projects'], ['projects', 'projects'],
  ['projectrevision', 'projects'], ['projectrevisions', 'projects'], ['revision', 'projects'],
  ['asset', 'assets'], ['assets', 'assets'], ['file', 'assets'], ['files', 'assets'],
  ['submission', 'submissions'], ['submissions', 'submissions'], ['pending', 'submissions'],
  ['review', 'reviews'], ['reviews', 'reviews'], ['like', 'project_likes'], ['likes', 'project_likes'],
  ['projectlikes', 'project_likes'], ['subscription', 'project_subscriptions'],
  ['subscriptions', 'project_subscriptions'], ['projectsubscribes', 'project_subscriptions'],
  ['projectsubscriptions', 'project_subscriptions'], ['rating', 'project_ratings'], ['ratings', 'project_ratings'],
  ['projectratings', 'project_ratings'], ['recommendation', 'recommendations'], ['recommendations', 'recommendations'],
  ['devteamrecommendations', 'recommendations'], ['sitesetting', 'site_settings'], ['sitesettings', 'site_settings'],
  ['referenceset', 'reference_sets'], ['referencesets', 'reference_sets'], ['characterreferences', 'reference_sets'],
  ['referenceversion', 'reference_versions'], ['referenceversions', 'reference_versions'],
  ['characterreferenceversions', 'reference_versions'], ['referenceitem', 'reference_items'],
  ['referenceitems', 'reference_items'], ['characterreferenceitems', 'reference_items'], ['audit', 'audit_events'],
  ['auditevents', 'audit_events'], ['adminactionlogs', 'audit_events'], ['projectmetricsdaily', 'project_metrics_daily']
]);

const text = (value, fallback = '') => value == null ? fallback : String(value);
const first = (row, keys, fallback = undefined) => {
  for (const key of keys) if (row?.[key] != null) return row[key];
  return fallback;
};
const dateOf = row => text(first(row, ['updated_at', 'updatedAt', 'created_at', 'createdAt', 'submitted_at'], ''));
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const safe = value => text(value).replace(/[^a-zA-Z0-9_.:-]/g, '_');
const idFor = (prefix, ...parts) => `${prefix}-${parts.map(safe).join('-')}`;
const json = value => typeof value === 'string' ? value : JSON.stringify(value ?? {});
const array = value => Array.isArray(value) ? value : value == null ? [] : typeof value === 'string' ? (() => { try { const x = JSON.parse(value); return Array.isArray(x) ? x : [value]; } catch { return [value]; } })() : [value];
const compare = (a, b) => {
  const x = stableStringify(a), y = stableStringify(b);
  return x < y ? -1 : x > y ? 1 : 0;
};
const stableRows = rows => [...rows].sort(compare);

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

async function filesUnder(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else out.push(full);
  }
  return out;
}
function tableName(name) {
  const stem = path.basename(name).replace(/\.(jsonl?|ndjson)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return aliases.get(stem) ?? null;
}
function rowsFrom(value, stem) {
  if (Array.isArray(value)) return value.filter(x => x && typeof x === 'object');
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.rows)) return value.rows;
  if (Array.isArray(value.items)) return value.items;
  const result = [];
  for (const [key, child] of Object.entries(value)) {
    const table = aliases.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (table === stem && Array.isArray(child)) result.push(...child);
  }
  return result.length ? result : [value];
}

/** Read only the caller-provided source directory. It never has a default source. */
export async function extract(sourceDir, options = {}) {
  const root = path.resolve(sourceDir);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error(`source is not a directory: ${sourceDir}`);
  const tables = Object.fromEntries(TABLES.map(name => [name, []]));
  for (const file of await filesUnder(root)) {
    if (!/\.(json|jsonl|ndjson)$/i.test(file)) continue;
    const name = tableName(file);
    if (!name) continue;
    const raw = await fs.readFile(file, 'utf8');
    let value;
    if (/\.(jsonl|ndjson)$/i.test(file)) value = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    else value = JSON.parse(raw);
    tables[name].push(...rowsFrom(value, name));
  }
  const since = options.since ? new Date(options.since) : null;
  if (since && Number.isNaN(since.valueOf())) throw new Error(`invalid --since timestamp: ${options.since}`);
  if (since) {
    const changedProjects = new Set(tables.projects.filter(row => {
      const stamp = dateOf(row);
      return stamp && !Number.isNaN(new Date(stamp).valueOf()) && new Date(stamp) >= since;
    }).map(row => text(first(row, ['id', 'project_id']))));
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const row of tables.projects) {
        const id = text(first(row, ['id', 'project_id']));
        const links = [row.root_project_id, row.published_project_id].filter(value => value != null).map(text);
        if (changedProjects.has(id) || links.some(link => changedProjects.has(link))) {
          if (!changedProjects.has(id)) { changedProjects.add(id); expanded = true; }
          for (const link of links) if (!changedProjects.has(link)) { changedProjects.add(link); expanded = true; }
        }
      }
    }
    for (const name of TABLES) tables[name] = tables[name].filter(row => {
      const stamp = dateOf(row);
      const changed = stamp && !Number.isNaN(new Date(stamp).valueOf()) && new Date(stamp) >= since;
      if (name !== 'projects') return Boolean(changed);
      return changedProjects.has(text(first(row, ['id', 'project_id'])));
    });
  }
  for (const name of TABLES) tables[name] = stableRows(tables[name]);
  return { format: 'workshop-legacy-extract-v1', since: options.since ?? null, tables };
}

function mergeUsers(source) {
  const byId = new Map();
  const add = (row, forcedRole) => {
    const rawId = first(row, ['id', 'user_id', 'discord_id', 'discordId', 'author_id', 'actor_id']);
    const id = text(rawId, idFor('legacy-user', hash(`${first(row, ['username', 'name'], '')}:${first(row, ['email'], '')}`)).slice(0, 16));
    const old = byId.get(id) ?? { id, username: text(first(row, ['username', 'name', 'global_name'], id), id), global_name: first(row, ['global_name', 'globalName', 'display_name']) ?? null, avatar: first(row, ['avatar', 'avatar_url', 'avatarUrl']) ?? null, role: 'member', created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), updated_at: text(first(row, ['updated_at', 'updatedAt'], '1970-01-01T00:00:00.000Z')) };
    const role = forcedRole ?? first(row, ['role'], (row.is_owner || row.is_super_admin || row.super_admin ? 'owner' : row.is_admin || row.admin ? 'reviewer' : 'member'));
    const rank = { member: 0, reviewer: 1, owner: 2 };
    if ((rank[role] ?? 0) > (rank[old.role] ?? 0)) old.role = rank[role] ? role : old.role;
    byId.set(id, { ...old, username: text(first(row, ['username', 'name', 'global_name'], old.username), old.username), global_name: first(row, ['global_name', 'globalName'], old.global_name), avatar: first(row, ['avatar', 'avatar_url', 'avatarUrl'], old.avatar), updated_at: text(first(row, ['updated_at', 'updatedAt'], old.updated_at)) });
    return id;
  };
  for (const row of source.tables.users) add(row);
  for (const row of [...source.tables.projects, ...source.tables.project_likes, ...source.tables.project_subscriptions, ...source.tables.project_ratings, ...source.tables.recommendations, ...source.tables.reviews]) {
    const uid = first(row, ['user_id', 'author_id', 'submitted_by', 'reviewer_id', 'curator_id']); if (uid != null) add({ id: uid, username: text(uid) });
  }
  for (const row of source.tables.audit_events ?? []) {
    const actor = first(row, ['actor_id', 'user_id']);
    if (actor != null) add({ id: actor });
  }
  return [...byId.values()].sort(compare);
}

function projectMap(source) {
  const rows = source.tables.projects;
  const parent = new Map(rows.map((row, i) => [text(first(row, ['id', 'project_id']), `row-${i}`), text(first(row, ['id', 'project_id']), `row-${i}`)]));
  const find = x => { let p = parent.get(x) ?? x; while (parent.get(p) && parent.get(p) !== p) p = parent.get(p); return p; };
  const union = (a, b) => { const x = find(a), y = find(b); if (x !== y) { if (x < y) parent.set(y, x); else parent.set(x, y); } };
  for (const row of rows) { const id = text(first(row, ['id', 'project_id'])); for (const key of ['published_project_id', 'root_project_id']) if (row[key] != null) { if (!parent.has(text(row[key]))) parent.set(text(row[key]), text(row[key])); union(id, text(row[key])); } }
  const groups = new Map();
  for (const row of rows) { const id = text(first(row, ['id', 'project_id'])); const key = find(id); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
  const canonical = new Map();
  for (const group of groups.values()) {
    const info = { pid: '', group };
    const published = [...group].sort((a, b) => {
      const ap = Number(Boolean(a.is_published || a.published || a.status === 'approved' || a.approved)), bp = Number(Boolean(b.is_published || b.published || b.status === 'approved' || b.approved));
      return bp - ap || dateOf(b).localeCompare(dateOf(a)) || text(a.id).localeCompare(text(b.id));
    })[0];
    info.pid = text(first(published, ['id', 'project_id']));
    for (const row of group) canonical.set(text(first(row, ['id', 'project_id'])), info);
  }
  return canonical;
}
function visibility(row) {
  const value = first(row, ['visibility', 'is_public', 'public']);
  if (value === 'public' || value === true || value === 1 || value === '1') return 'public';
  return 'private';
}
function revisionRows(info) {
  const sorted = [...info.group].sort((a, b) => {
    const rank = row => row.is_published || row.published || row.status === 'approved' || row.approved ? 0 : row.status === 'rejected' ? 2 : 1;
    return rank(a) - rank(b) || dateOf(b).localeCompare(dateOf(a)) || text(a.id).localeCompare(text(b.id));
  });
  const picked = [];
  for (const row of sorted) {
    if (picked.some(x => text(x.id) === text(row.id))) continue;
    const rejected = row.status === 'rejected' && !(row.is_published || row.published || row.approved);
    if (picked.length < 2 || (rejected && !picked.some(x => x.status === 'rejected'))) picked.push(row);
  }
  return picked;
}
function roleUser(id, users) { return users.some(x => x.id === id) ? id : users[0]?.id ?? idFor('legacy-user', 'unknown'); }
function extensionFor(value, mime) {
  const match = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(text(value));
  if (match) return match[1].toLowerCase();
  const known = {
    'application/json': 'json', 'application/zip': 'zip', 'text/plain': 'txt',
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  };
  return known[mime] ?? 'bin';
}

export function transform(source) {
  const users = mergeUsers(source), map = projectMap(source);
  const tables = Object.fromEntries(TABLES.map(name => [name, []]));
  tables.users = users;
  const revByLegacy = new Map(), projectInfo = new Map();
  for (const info of new Set([...map.values()])) {
    const rows = revisionRows(info); const pub = rows[0]; const base = pub ?? info.group[0];
    const project = { id: info.pid, author_id: roleUser(text(first(base, ['author_id', 'user_id', 'owner_id']), users[0]?.id), users), title: text(first(base, ['title', 'name'], info.pid), info.pid), description: first(base, ['description', 'summary']) ?? null, author_note: first(base, ['author_note', 'authorNote']) ?? null, project_type: first(base, ['project_type', 'type']) ?? null, extension_type: first(base, ['extension_type', 'extension']) ?? null, search_tags: json(array(first(base, ['search_tags', 'tags'], []))), visibility: visibility(base), working_revision_id: null, published_revision_id: null, published_at: first(base, ['published_at', 'publishedAt']) ?? null, downloads_count: Number(first(base, ['downloads_count', 'downloads'], 0)) || 0, likes_count: 0, subscriptions_count: 0, row_version: 1, created_at: text(first(base, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), updated_at: text(first(base, ['updated_at', 'updatedAt'], dateOf(base))) || '1970-01-01T00:00:00.000Z', deleted_at: first(base, ['deleted_at', 'deletedAt']) ?? null };
    const revisions = rows.map((row, index) => { const sourceId = text(first(row, ['id', 'project_id']), String(index)); const id = idFor('revision', project.id, sourceId); revByLegacy.set(sourceId, id); const isPub = index === 0 && (row.is_published || row.published || row.status === 'approved' || row.approved); const rev = { id, project_id: project.id, revision_no: index + 1, title: text(first(row, ['title', 'name'], project.title), project.title), description: first(row, ['description', 'summary'], project.description) ?? null, author_note: first(row, ['author_note', 'authorNote'], project.author_note) ?? null, project_type: first(row, ['project_type', 'type'], project.project_type) ?? null, extension_type: first(row, ['extension_type', 'extension'], project.extension_type) ?? null, facets: json(first(row, ['facets', 'metadata.facets'], {})), custom_tags: json(array(first(row, ['custom_tags', 'customTags'], []))), tags: json(array(first(row, ['tags', 'search_tags'], []))), metadata: json(first(row, ['metadata'], {})), manifest_hash: first(row, ['manifest_hash', 'manifestHash']) ?? null, worldbook_count: Number(first(row, ['worldbook_count', 'worldbookCount'], 0)) || 0, regex_count: Number(first(row, ['regex_count', 'regexCount'], 0)) || 0, schema_version: first(row, ['schema_version', 'schemaVersion']) ?? null, discord_thread_url: first(row, ['discord_thread_url', 'discordThreadUrl']) ?? null, created_by: project.author_id, created_at: text(first(row, ['created_at', 'createdAt'], project.created_at), project.created_at) }; if (isPub) project.published_revision_id = id; return rev; });
    const currentDraft = rows.find(row => !(row.is_published || row.published || row.status === 'approved' || row.approved) && row.status !== 'rejected');
    project.working_revision_id = revByLegacy.get(text(first(currentDraft ?? pub, ['id', 'project_id']))) ?? revisions[0]?.id ?? null;
    tables.projects.push(project); tables.project_revisions.push(...revisions); projectInfo.set(project.id, { project, revisions });
  }
  for (const row of source.tables.assets) {
    const oldProject = text(first(row, ['project_id', 'projectId']));
    const info = map.get(oldProject);
    if (!info) continue;
    const project = projectInfo.get(info.pid)?.project;
    if (!project) continue;
    const revisionId = revByLegacy.get(text(first(row, ['revision_id', 'revisionId', 'project_id']))) ?? project.working_revision_id;
    const kind = text(first(row, ['kind', 'type'], 'worldbook'));
    if (!['worldbook', 'regex', 'cover', 'avatar', 'banner'].includes(kind)) continue;
    const sourceKey = text(first(row, ['r2_key', 'key', 'path']));
    const mime = text(first(row, ['mime', 'content_type'], kind === 'cover' ? 'image/*' : 'application/json'));
    const sha256 = text(first(row, ['sha256', 'hash'], hash(`${project.id}:${revisionId}:${kind}`)));
    const r2Key = kind === 'cover'
      ? `covers/${project.id}/${revisionId}-${sha256}.${extensionFor(sourceKey, mime)}`
      : `projects/${project.id}/revisions/${revisionId}/${kind}-${sha256}.${extensionFor(sourceKey, mime)}`;
    tables.assets.push({ id: text(first(row, ['id']), idFor('asset', project.id, revisionId, kind)), project_id: project.id, revision_id: revisionId, kind, r2_key: r2Key, sha256, bytes: Number(first(row, ['bytes', 'size'], 0)) || 0, mime, created_at: text(first(row, ['created_at', 'createdAt'], project.created_at), project.created_at) });
  }
  const entryCounts = new Map();
  for (const asset of tables.assets) {
    const counts = entryCounts.get(asset.revision_id) ?? { worldbook: 0, regex: 0 };
    if (asset.kind === 'worldbook' || asset.kind === 'regex') counts[asset.kind] += 1;
    entryCounts.set(asset.revision_id, counts);
  }
  for (const revision of tables.project_revisions) {
    const counts = entryCounts.get(revision.id);
    revision.worldbook_count = counts?.worldbook ?? 0;
    revision.regex_count = counts?.regex ?? 0;
  }
  const userId = row => roleUser(text(first(row, ['user_id', 'author_id', 'actor_id', 'submitted_by', 'reviewer_id', 'curator_id'])), users);
  for (const row of source.tables.project_likes) { const p = map.get(text(first(row, ['project_id', 'projectId']))); if (p) tables.project_likes.push({ project_id: p.pid, user_id: userId(row), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  for (const row of source.tables.project_subscriptions) { const p = map.get(text(first(row, ['project_id', 'projectId']))); if (p) tables.project_subscriptions.push({ project_id: p.pid, user_id: userId(row), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  for (const row of source.tables.project_ratings) { const p = map.get(text(first(row, ['project_id', 'projectId']))); if (p) tables.project_ratings.push({ project_id: p.pid, user_id: userId(row), rating: Math.max(1, Math.min(5, Number(first(row, ['rating', 'score'], 1)) || 1)), comment_text: first(row, ['comment_text', 'comment']) ?? null, created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), updated_at: text(first(row, ['updated_at', 'updatedAt'], '1970-01-01T00:00:00.000Z')) }); }
  for (const project of tables.projects) { project.likes_count = tables.project_likes.filter(x => x.project_id === project.id).length; project.subscriptions_count = tables.project_subscriptions.filter(x => x.project_id === project.id).length; }
  const pending = new Set();
  for (const row of source.tables.submissions.sort((a, b) => dateOf(b).localeCompare(dateOf(a)))) { const p = map.get(text(first(row, ['project_id', 'projectId']))); if (!p) continue; const project = projectInfo.get(p.pid)?.project; const status = text(first(row, ['status'], 'pending')).toLowerCase(); const normalized = ['checking', 'approved', 'rejected', 'superseded'].includes(status) ? status : 'pending'; if ((normalized === 'pending' || normalized === 'checking') && pending.has(p.pid)) continue; if (normalized === 'pending' || normalized === 'checking') pending.add(p.pid); const id = text(first(row, ['id', 'submission_id']), idFor('submission', p.pid, first(row, ['revision_id'], project?.working_revision_id))); const revisionId = revByLegacy.get(text(first(row, ['revision_id', 'revisionId']))) ?? project?.working_revision_id; tables.submissions.push({ id, project_id: p.pid, revision_id: revisionId, status: normalized, gate: first(row, ['gate', 'client_gate']) ?? 'missing', checker_revision: first(row, ['checker_revision', 'checkerVersion']) ?? null, submitted_by: userId(row), submitted_at: text(first(row, ['submitted_at', 'created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), resolved_at: first(row, ['resolved_at', 'resolvedAt']) ?? null }); }
  for (const row of source.tables.reviews) { const sid = text(first(row, ['submission_id', 'submissionId'])); const sub = tables.submissions.find(x => x.id === sid); if (!sub) continue; tables.reviews.push({ id: text(first(row, ['id']), idFor('review', sid)), submission_id: sid, reviewer_id: userId(row), decision: first(row, ['decision'], 'reject') === 'approve' ? 'approve' : 'reject', reason: first(row, ['reason']) ?? null, manifest_hash: first(row, ['manifest_hash', 'manifestHash']) ?? null, checker_version: first(row, ['checker_version', 'checkerVersion']) ?? null, report: json(first(row, ['report'], {})), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  for (const row of source.tables.recommendations) { const p = map.get(text(first(row, ['project_id', 'projectId']))); if (p) tables.recommendations.push({ id: text(first(row, ['id']), idFor('recommendation', p.pid, first(row, ['curator_id', 'user_id'], 'unknown'))), curator_id: userId(row), project_id: p.pid, comment: text(first(row, ['comment'], '')), reaction: text(first(row, ['reaction'], '')), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), updated_at: text(first(row, ['updated_at', 'updatedAt'], '1970-01-01T00:00:00.000Z')) }); }
  const referenceSetIds = new Map();
  for (const row of source.tables.reference_sets) { const legacyId = text(first(row, ['id', 'reference_set_id']), idFor('reference-set', first(row, ['name'], 'unnamed'))); const creator = roleUser(text(first(row, ['created_by', 'user_id', 'author_id'])), users); const id = text(first(row, ['id', 'reference_set_id']), idFor('reference-set', first(row, ['name'], 'unnamed'))); referenceSetIds.set(legacyId, id); tables.reference_sets.push({ id, name: text(first(row, ['name', 'title'], 'Unnamed reference set')), description: first(row, ['description']) ?? null, created_by: creator, created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')), updated_at: text(first(row, ['updated_at', 'updatedAt'], '1970-01-01T00:00:00.000Z')) }); }
  const referenceSetIdValues = new Set(tables.reference_sets.map(x => x.id));
  const referenceVersionIds = new Map();
  for (const row of source.tables.reference_versions) { const legacySetId = text(first(row, ['reference_set_id', 'set_id'])); const setId = referenceSetIds.get(legacySetId) ?? legacySetId; if (!referenceSetIdValues.has(setId)) continue; const id = text(first(row, ['id', 'version_id']), idFor('reference-version', setId, first(row, ['version_label', 'version'], '1'))); referenceVersionIds.set(text(first(row, ['id', 'version_id']), id), id); tables.reference_versions.push({ id, reference_set_id: setId, version_label: text(first(row, ['version_label', 'version'], '1')), version_ordinal: Number(first(row, ['version_ordinal', 'ordinal'], 1)) || 1, grace_until: text(first(row, ['grace_until', 'graceUntil'], '9999-12-31T00:00:00.000Z')), created_by: roleUser(text(first(row, ['created_by', 'user_id', 'author_id'])), users), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  const referenceVersionIdValues = new Set(tables.reference_versions.map(x => x.id));
  for (const row of source.tables.reference_items) { const legacyVersionId = text(first(row, ['reference_version_id', 'version_id'])); const versionId = referenceVersionIds.get(legacyVersionId) ?? legacyVersionId; if (!referenceVersionIdValues.has(versionId)) continue; const exact = text(first(row, ['exact_hash', 'hash'], hash(json(row)))); tables.reference_items.push({ id: text(first(row, ['id', 'item_id']), idFor('reference-item', versionId, exact)), reference_version_id: versionId, kind: first(row, ['kind', 'type'], 'worldbook') === 'regex' ? 'regex' : 'worldbook', source_key: first(row, ['source_key', 'key']) ?? null, display_name: text(first(row, ['display_name', 'name'], 'Unnamed item')), exact_hash: exact, normalized_content_hash: text(first(row, ['normalized_content_hash', 'normalized_hash'], exact)), name_hash: text(first(row, ['name_hash'], hash(first(row, ['display_name', 'name'], '')))), keys_hash: first(row, ['keys_hash']) ?? null, structure_hash: text(first(row, ['structure_hash'], exact)), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  for (const row of source.tables.audit_events) { tables.audit_events.push({ id: text(first(row, ['id', 'event_id']), idFor('audit', first(row, ['action'], 'event'), first(row, ['target_id'], 'unknown'))), action: text(first(row, ['action'], 'migration')), target_type: text(first(row, ['target_type', 'targetType'], 'legacy')), target_id: first(row, ['target_id', 'targetId']) ?? null, actor_id: first(row, ['actor_id', 'user_id']) ?? null, detail: first(row, ['detail', 'metadata']) == null ? null : json(first(row, ['detail', 'metadata'])), created_at: text(first(row, ['created_at', 'createdAt'], '1970-01-01T00:00:00.000Z')) }); }
  const assetSha256 = {};
  for (const row of source.tables.assets) {
    const oldProject = text(first(row, ['project_id', 'projectId']));
    const info = map.get(oldProject);
    const project = info && projectInfo.get(info.pid)?.project;
    if (!project) continue;
    const revisionId = revByLegacy.get(text(first(row, ['revision_id', 'revisionId', 'project_id']))) ?? project.working_revision_id;
    const kind = text(first(row, ['kind', 'type'], 'worldbook'));
    if (!['worldbook', 'regex', 'cover', 'avatar', 'banner'].includes(kind)) continue;
    const id = text(first(row, ['id']), idFor('asset', project.id, revisionId, kind));
    assetSha256[id] = text(first(row, ['sha256', 'hash'], hash(`${project.id}:${revisionId}:${kind}`)));
    const asset = tables.assets.find(candidate => candidate.id === id);
    if (asset && row.content_base64 != null) asset.content_base64 = row.content_base64;
  }
  for (const name of TABLES) tables[name] = stableRows(tables[name]);
  const sourceGroups = [...new Set([...map.values()])];
  const projectCount = sourceGroups.length;
  const publishedGroups = sourceGroups.filter(info => info.group.some(row => row.is_published || row.published || row.status === 'approved' || row.approved));
  const publishedCount = publishedGroups.length;
  const expectedProjectIds = sourceGroups.map(info => info.pid).sort();
  const expectedPublishedProjectIds = publishedGroups.map(info => info.pid).sort();
  return { format: 'workshop-migration-v1', meta: { expectedProjectCount: projectCount, expectedProjectIds, expectedPublishedPointerCount: publishedCount, expectedPublishedProjectIds, assetSha256, sourceCounts: { projects: projectCount, users: users.length } }, tables };
}

function rowKey(row) {
  if (row?.id != null) return `id:${row.id}`;
  if (row?.project_id != null && row?.user_id != null) return `pu:${row.project_id}:${row.user_id}:${row.day_key ?? ''}`;
  if (row?.project_id != null && row?.day_key != null) return `pd:${row.project_id}:${row.day_key}`;
  return null;
}
function duplicateIds(rows) {
  const seen = new Set(), duplicate = [];
  for (const row of rows) {
    const keys = [rowKey(row)];
    if (row?.r2_key != null) keys.push(`r2:${row.r2_key}`);
    for (const key of keys) {
      if (key == null) continue;
      if (seen.has(key)) duplicate.push(key);
      seen.add(key);
    }
  }
  return duplicate;
}
export function verify(target) {
  const mismatches = [], tables = target?.tables ?? {};
  const projects = Array.isArray(tables.projects) ? tables.projects : [];
  if (target?.meta?.expectedProjectCount !== projects.length) mismatches.push({ check: 'project_count', expected: target?.meta?.expectedProjectCount, actual: projects.length });
  const published = projects.filter(x => x.published_revision_id).length;
  if (target?.meta?.expectedPublishedPointerCount !== published) mismatches.push({ check: 'published_pointer_count', expected: target?.meta?.expectedPublishedPointerCount, actual: published });
  const actualProjectIds = projects.map(row => row.id).sort();
  const actualPublishedProjectIds = projects.filter(row => row.published_revision_id).map(row => row.id).sort();
  if (Array.isArray(target?.meta?.expectedProjectIds) && stableStringify(target.meta.expectedProjectIds) !== stableStringify(actualProjectIds)) mismatches.push({ check: 'project_identity', expected: target.meta.expectedProjectIds, actual: actualProjectIds });
  if (Array.isArray(target?.meta?.expectedPublishedProjectIds) && stableStringify(target.meta.expectedPublishedProjectIds) !== stableStringify(actualPublishedProjectIds)) mismatches.push({ check: 'published_project_identity', expected: target.meta.expectedPublishedProjectIds, actual: actualPublishedProjectIds });
  for (const name of TABLES) { const dup = duplicateIds(tables[name] ?? []); if (dup.length) mismatches.push({ check: 'duplicate_ids', table: name, ids: dup }); }
  const ids = new Set(projects.map(x => x.id)), revisions = new Set((tables.project_revisions ?? []).map(x => x.id)), users = new Set((tables.users ?? []).map(x => x.id));
  for (const row of projects) { if (!users.has(row.author_id)) mismatches.push({ check: 'fk', table: 'projects', id: row.id, field: 'author_id' }); for (const key of ['working_revision_id', 'published_revision_id']) if (row[key] && !revisions.has(row[key])) mismatches.push({ check: 'fk', table: 'projects', id: row.id, field: key }); }
  for (const [name, rows] of Object.entries(tables)) for (const row of rows ?? []) { if (row.project_id && !ids.has(row.project_id)) mismatches.push({ check: 'fk', table: name, id: row.id }); if (row.user_id && !users.has(row.user_id)) mismatches.push({ check: 'fk', table: name, id: row.id }); }
  for (const row of tables.project_revisions ?? []) { if (!ids.has(row.project_id) || !users.has(row.created_by)) mismatches.push({ check: 'fk', table: 'project_revisions', id: row.id }); }
  for (const row of tables.assets ?? []) { if (!ids.has(row.project_id) || (row.revision_id && !revisions.has(row.revision_id))) mismatches.push({ check: 'fk', table: 'assets', id: row.id }); }
  const assetCounts = new Map();
  for (const asset of tables.assets ?? []) {
    const counts = assetCounts.get(asset.revision_id) ?? { worldbook: 0, regex: 0 };
    if (asset.kind === 'worldbook' || asset.kind === 'regex') counts[asset.kind] += 1;
    assetCounts.set(asset.revision_id, counts);
  }
  for (const revision of tables.project_revisions ?? []) {
    const expected = assetCounts.get(revision.id) ?? { worldbook: 0, regex: 0 };
    if (revision.worldbook_count !== expected.worldbook || revision.regex_count !== expected.regex) {
      mismatches.push({ check: 'entry_counts', id: revision.id, expected, actual: { worldbook: revision.worldbook_count, regex: revision.regex_count } });
    }
  }
  const submissions = new Set((tables.submissions ?? []).map(x => x.id));
  for (const row of tables.submissions ?? []) { if (!ids.has(row.project_id) || !revisions.has(row.revision_id) || !users.has(row.submitted_by)) mismatches.push({ check: 'fk', table: 'submissions', id: row.id }); }
  for (const row of tables.reviews ?? []) { if (!submissions.has(row.submission_id) || !users.has(row.reviewer_id)) mismatches.push({ check: 'fk', table: 'reviews', id: row.id }); }
  const referenceSets = new Set((tables.reference_sets ?? []).map(x => x.id)), referenceVersions = new Set((tables.reference_versions ?? []).map(x => x.id));
  for (const row of tables.reference_sets ?? []) if (!users.has(row.created_by)) mismatches.push({ check: 'fk', table: 'reference_sets', id: row.id });
  for (const row of tables.reference_versions ?? []) if (!referenceSets.has(row.reference_set_id) || !users.has(row.created_by)) mismatches.push({ check: 'fk', table: 'reference_versions', id: row.id });
  for (const row of tables.reference_items ?? []) if (!referenceVersions.has(row.reference_version_id)) mismatches.push({ check: 'fk', table: 'reference_items', id: row.id });
  for (const asset of tables.assets ?? []) { const expectedHash = target?.meta?.assetSha256?.[asset.id]; if (expectedHash && expectedHash.toLowerCase() !== text(asset.sha256).toLowerCase()) mismatches.push({ check: 'asset_sha256', id: asset.id, expected: expectedHash, actual: asset.sha256 }); if (!/^[a-f0-9]{64}$/i.test(text(asset.sha256))) mismatches.push({ check: 'asset_sha256', id: asset.id, sha256: asset.sha256 }); if (asset.content_base64) { const actual = createHash('sha256').update(Buffer.from(asset.content_base64, 'base64')).digest('hex'); if (actual !== asset.sha256.toLowerCase()) mismatches.push({ check: 'asset_sha256', id: asset.id, expected: asset.sha256, actual }); } }
  const pending = new Set(); for (const row of tables.submissions ?? []) if (row.status === 'pending' || row.status === 'checking') { if (pending.has(row.project_id)) mismatches.push({ check: 'pending_submission_unique', project_id: row.project_id }); pending.add(row.project_id); }
  const has = check => mismatches.some(item => item.check === check);
  return {
    ok: mismatches.length === 0,
    checks: {
      projectCount: projects.length,
      publishedPointerCount: published,
      assets: (tables.assets ?? []).length,
      foreignKeys: !has('fk'),
      duplicateIds: !has('duplicate_ids'),
      pendingSubmissionUniqueness: !has('pending_submission_unique'),
    },
    mismatches,
  };
}

export function reconcile(expected, target) {
  const mismatches = [], counts = {};
  for (const name of TABLES) { const left = expected.tables?.[name] ?? [], right = target.tables?.[name] ?? []; counts[name] = { expected: left.length, actual: right.length }; if (stableStringify(stableRows(left)) !== stableStringify(stableRows(right))) { const rightSet = new Set(right.map(stableStringify)); const leftSet = new Set(left.map(stableStringify)); mismatches.push({ table: name, missing: left.filter(x => !rightSet.has(stableStringify(x))).slice(0, 20), unexpected: right.filter(x => !leftSet.has(stableStringify(x))).slice(0, 20) }); } }
  return { ok: mismatches.length === 0, counts, mismatches };
}

export async function writeJson(file, value) { await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true }); await fs.writeFile(file, `${stableStringify(value)}\n`, 'utf8'); }
export async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
export { TABLES };

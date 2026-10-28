import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { worldbook as persistBook, regex as persistRegex } from "./host-fixture.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-install-"));
const outfile = path.join(dir, "install.mjs");
await build({
  entryPoints: [path.resolve("src/install.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const { createInstallManager } = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));
const clone = (value) => structuredClone(value);
function harness() {
  const state = {
    books: { A: [], B: [] },
    regex: [],
    records: {},
    character: "avatar.png",
    bindings: { primary: "A", additional: [] },
    writes: 0,
    fail: null,
    beforeUpdate: null,
    failFinalSave: false,
  };
  let n = 0;
  const manager = createInstallManager({
    character: () => state.character,
    names: () => Object.keys(state.books),
    bindings: () => clone(state.bindings),
    async book(name) {
      if (state.fail === name) throw new Error("read failed");
      return clone(state.books[name].map(persistBook));
    },
    regex: () => clone(state.regex.map(persistRegex)),
    records: () => clone(state.records),
    uuid: () => `id-${++n}`,
    async updateBook(name, update) {
      state.beforeUpdate?.();
      const next = update(clone(state.books[name].map(persistBook)));
      state.writes++;
      state.books[name] = clone(next.map(persistBook));
    },
    async updateRegex(update) {
      const next = update(clone(state.regex.map(persistRegex)));
      state.writes++;
      state.regex = clone(next.map(persistRegex));
    },
    async createBook(name) {
      state.writes++;
      state.books[name] = [];
    },
    async bind(name) {
      state.writes++;
      state.bindings.additional.push(name);
    },
    async saveRecords(records) {
      if (state.failFinalSave && Object.values(records).some((record) => !record.pending))
        throw new Error("save interrupted");
      state.writes++;
      state.records = clone(records);
    },
  });
  return { state, manager };
}
const files = (text) => ({
  worldbook: JSON.stringify({ entries: [{ uid: 1, name: "Entry", content: text }] }),
  regex: JSON.stringify([{ id: "r", scriptName: "R", findRegex: "a", replaceString: text }]),
});
async function install(h, target, version = "1") {
  const p = await h.manager.preview({
    action: "install",
    project: { id: "p", version },
    files: files(version),
    targetWorldbook: target,
  });
  await h.manager.confirm(p.previewId);
  return p.instanceId;
}
test("same project in two books has independent versions and character regex ownership", async () => {
  const h = harness();
  const a = await install(h, "A");
  const b = await install(h, "B", "2");
  const untouched = clone(h.state.books.B);
  const bIds = new Set(h.state.records[b].baseline.regex.map((r) => r.id));
  const untouchedRegex = clone(h.state.regex.filter((r) => bIds.has(r.id)));
  h.state.books.A[0].content = "player edit";
  const preview = await h.manager.preview({
    action: "update",
    instanceId: a,
    project: { id: "p", version: "3" },
    files: files("3"),
  });
  assert.ok(preview.playerChanges.some((d) => d.before.includes('"1"') && d.after.includes("player edit")));
  await h.manager.confirm(preview.previewId);
  assert.equal(h.state.books.A[0].content, "3");
  assert.deepEqual(h.state.books.B, untouched);
  assert.deepEqual(
    h.state.regex.filter((r) => bIds.has(r.id)),
    untouchedRegex,
  );
  assert.deepEqual((await h.manager.scan()).instances.map((i) => i.version).sort(), ["2", "3"]);
  h.state.books.A.push({ uid: 77, content: "user note" });
  h.state.books.A[0].content = "edited again";
  const remove = await h.manager.preview({ action: "uninstall", instanceId: a });
  assert.ok(remove.playerChanges.length);
  await h.manager.confirm(remove.previewId);
  assert.deepEqual(h.state.books.A, [persistBook({ uid: 77, content: "user note" })]);
  assert.equal((await h.manager.scan()).instances.length, 1);
});
test("preview/cancel is zero writes, stale content and switched character are rejected", async () => {
  const h = harness();
  const id = await install(h, "A");
  const writes = h.state.writes;
  const p = await h.manager.preview({ action: "uninstall", instanceId: id });
  assert.equal(h.state.writes, writes);
  h.manager.cancel(p.previewId);
  await assert.rejects(h.manager.confirm(p.previewId), /取消/);
  assert.equal(h.state.writes, writes);
  const stale = await h.manager.preview({ action: "uninstall", instanceId: id });
  h.state.books.A[0].content = "late edit";
  await assert.rejects(h.manager.confirm(stale.previewId), /重新查看 diff/);
  assert.equal(h.state.writes, writes);
  const switched = await h.manager.preview({ action: "uninstall", instanceId: id });
  h.state.character = "other.png";
  await assert.rejects(h.manager.confirm(switched.previewId), /重新查看 diff/);
  assert.equal(h.state.writes, writes);
});
test("updater rechecks latest content, preventing read/write gap overwrite", async () => {
  const h = harness();
  const id = await install(h, "A");
  const p = await h.manager.preview({ action: "uninstall", instanceId: id });
  const writes = h.state.writes;
  h.state.beforeUpdate = () => {
    h.state.books.A[0].content = "racing edit";
  };
  await assert.rejects(h.manager.confirm(p.previewId), /世界书已改变/);
  assert.equal(h.state.writes, writes);
  assert.equal(h.state.books.A[0].content, "racing edit");
});
test("scan explicitly reports all books, failed reads and ambiguous names or malformed metadata without writes", async () => {
  const h = harness();
  h.state.books.A = [
    { uid: 1, name: "[DLC] guessed", content: "x" },
    {
      uid: 2,
      content: '<%# poem-workshop-meta:v1-start\n{"cw_project_id":"p"} %>',
      extra: { cw_project_id: "p", cw_project_version: "1", cw_entry_key: "k" },
    },
  ];
  h.state.fail = "B";
  const result = await h.manager.scan();
  assert.equal(result.instances.length, 0);
  assert.equal(result.ambiguous.length, 2);
  assert.deepEqual(result.scope.worldbooks, ["A", "B"]);
  assert.equal(result.scope.otherCharacters, "not-scanned");
  assert.equal(result.failures[0].location, "B");
  assert.equal(h.state.writes, 0);
});
test("canonical legacy EJS beats stale extra and migrate/new book binding preserves unrelated rows", async () => {
  const h = harness();
  const meta = {
    cw_project_id: "legacy",
    cw_project_version: "1",
    cw_entry_key: "k",
    cw_project_name_display: "Legacy",
    cw_name_format_version: 4,
  };
  h.state.books.A = [
    {
      uid: 4,
      content: `<%# poem-workshop-meta:v1-start\n${JSON.stringify(meta)}\npoem-workshop-meta:v1-end %>body`,
      extra: { cw_project_id: "wrong" },
    },
    { uid: 5, content: "unrelated" },
  ];
  const initial = await h.manager.scan();
  assert.equal(initial.instances[0].projectId, "legacy");
  const p = await h.manager.preview({
    action: "migrate",
    instanceId: initial.instances[0].instanceId,
    targetWorldbook: "New",
    createWorldbook: true,
    bindWorldbook: true,
  });
  assert.equal(h.state.writes, 0);
  await h.manager.confirm(p.previewId);
  assert.equal(h.state.books.New.length, 1);
  assert.deepEqual(h.state.books.A, [persistBook({ uid: 5, content: "unrelated" })]);
  assert.deepEqual(h.state.bindings.additional, ["New"]);
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 1);
  assert.equal(scan.instances[0].location.worldbook, "New");
});
test("duplicate legacy entry identities cannot be claimed or rewritten", async () => {
  const h = harness();
  const row = { content: "body", extra: { cw_project_id: "p", cw_project_version: "1", cw_entry_key: "same" } };
  h.state.books.A = [clone(row), clone(row)];
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 0);
  assert.ok(scan.ambiguous.length);
  await assert.rejects(h.manager.preview({ action: "uninstall", instanceId: "legacy:p:book:A" }), /存疑/);
  assert.equal(h.state.writes, 0);
});

test("RegExp source and flags participate in diff and stale confirmation checks", async () => {
  const h = harness();
  const id = await install(h, "A");
  h.state.books.A[0].strategy.keys = [/foo/i];
  const p = await h.manager.preview({ action: "uninstall", instanceId: id });
  assert.ok(p.playerChanges.some((d) => d.after.includes('"$regexp":"foo"')));
  const writes = h.state.writes;
  h.state.books.A[0].strategy.keys = [/bar/g];
  await assert.rejects(h.manager.confirm(p.previewId), /重新查看 diff/);
  assert.equal(h.state.writes, writes);
});

test("UUID regex ownership survives unsupported fields being dropped and interrupted final record save", async () => {
  const h = harness();
  const p = await h.manager.preview({
    action: "install",
    project: { id: "p", version: "1" },
    files: { regex: files("1").regex },
  });
  h.state.failFinalSave = true;
  await assert.rejects(h.manager.confirm(p.previewId), /save interrupted/);
  assert.equal(h.state.regex[0].extensions, undefined);
  assert.equal(h.state.records[p.instanceId].pending, true);
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 0);
  assert.ok(scan.ambiguous.some((a) => a.reason.includes("中断")));
  h.state.regex = []; // User follows the manual uninstall guidance.
  const writes = h.state.writes;
  const clean = await h.manager.scan();
  assert.deepEqual(clean.ambiguous, []);
  const intent = { action: "install", project: { id: "p", version: "2" }, files: { regex: files("2").regex } };
  const cancelled = await h.manager.preview(intent);
  h.manager.cancel(cancelled.previewId);
  assert.equal(h.state.writes, writes);
  assert.equal(h.state.records[p.instanceId].pending, true);
  const retry = await h.manager.preview(intent);
  h.state.failFinalSave = false;
  await h.manager.confirm(retry.previewId);
  assert.equal(h.state.records[p.instanceId], undefined);
  assert.equal((await h.manager.scan()).instances[0].version, "2");
});

test("unscoped old script registry cannot assign another character's version", async () => {
  const h = harness();
  h.state.regex = [
    persistRegex({ id: "cw-p-0", script_name: "[工坊] P", enabled: true, find_regex: "v1", replace_string: "x" }),
  ];
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 0);
  assert.ok(scan.ambiguous.some((a) => a.location.includes("cw-p-0")));
  assert.equal(h.state.writes, 0);
});

test("failed regex write reports partial installation without rolling back worldbook or claiming success", async () => {
  const h = harness();
  const id = await install(h, "A");
  const foreign = { uid: 77, content: "unrelated player note" };
  h.state.books.A.push(foreign);
  const preview = await h.manager.preview({
    action: "update",
    instanceId: id,
    project: { id: "p", version: "2" },
    files: files("2"),
  });
  h.state.beforeUpdate = () => {
    h.state.regex[0].replace_string = "external edit before regex write";
  };
  await assert.rejects(h.manager.confirm(preview.previewId), /局部写入.*重新扫描/);
  assert.equal(h.state.books.A.find((row) => row.extra?.cw_instance_id === id).content, "2");
  assert.ok(h.state.books.A.some((row) => row.content === foreign.content));
  assert.equal(h.state.regex[0].replace_string, "external edit before regex write");
  assert.equal(h.state.records[id].pending, true);
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 0);
  assert.ok(scan.ambiguous.some((item) => item.reason.includes("中断")));
});

test("an intent cannot replace another project's instance or turn uninstall into a binding operation", async () => {
  const h = harness();
  const id = await install(h, "A");
  const before = clone(h.state);
  await assert.rejects(
    h.manager.preview({
      action: "update",
      instanceId: id,
      project: { id: "foreign", version: "2" },
      files: files("wrong project"),
    }),
    /项目与实例不匹配/,
  );
  await assert.rejects(h.manager.preview({ action: "uninstall", instanceId: id, bindWorldbook: true }), /卸载不能/);
  assert.deepEqual(h.state, before);
});

test("copied instance stamps at an unregistered location do not authorize deletion", async () => {
  const h = harness();
  const id = await install(h, "A");
  h.state.books.B = clone(h.state.books.A);
  const writes = h.state.writes;
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 0);
  assert.ok(scan.ambiguous.some((item) => item.reason.includes("非登记位置")));
  await assert.rejects(h.manager.preview({ action: "uninstall", instanceId: id }), /存疑/);
  assert.equal(h.state.writes, writes);
  assert.equal(h.state.books.A[0].content, "1");
  assert.equal(h.state.books.B[0].content, "1");
});

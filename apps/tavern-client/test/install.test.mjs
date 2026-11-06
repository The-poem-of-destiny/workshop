import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parse as parseYaml } from "yaml";
import { worldbook as persistBook, regex as persistRegex } from "./host-fixture.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-install-"));
const outfile = path.join(dir, "install.mjs");
await build({
  entryPoints: [path.resolve("src/install.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile,
  logLevel: "silent",
});
const { createInstallManager } = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));
const clone = (value) => structuredClone(value);
const registryName = "[WS]创意工坊项目注册表";
const entries = (book) => book.filter((row) => row.name !== registryName);
const contentBody = (row) =>
  row.content.replace(/\n?<%#([\s\S]*?)%>/g, (block, body) => {
    try {
      return parseYaml(body)?.workshop_entry ? "" : block;
    } catch {
      return block;
    }
  });
const yamlBlocks = (row) =>
  [...row.content.matchAll(/<%#([\s\S]*?)%>/g)]
    .map((match) => {
      try {
        return parseYaml(match[1]);
      } catch {
        return null;
      }
    })
    .filter((value) => value && typeof value === "object");
const namespace = (row, key) => yamlBlocks(row).find((value) => Object.hasOwn(value, key))?.[key];
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
    beforeRead: null,
  };
  let n = 0;
  const manager = createInstallManager({
    character: () => state.character,
    names: () => Object.keys(state.books),
    bindings: () => clone(state.bindings),
    async book(name) {
      await state.beforeRead?.(name);
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
  worldbook: JSON.stringify({ entries: [{ uid: 1, name: "[WS] Entry", content: text }] }),
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
  entries(h.state.books.A)[0].content += "player edit";
  const preview = await h.manager.preview({
    action: "update",
    instanceId: a,
    project: { id: "p", version: "3" },
    files: files("3"),
  });
  assert.ok(preview.playerChanges.some((d) => d.after.includes("player edit")));
  await h.manager.confirm(preview.previewId);
  assert.equal(contentBody(entries(h.state.books.A)[0]), "3");
  assert.deepEqual(h.state.books.B, untouched);
  assert.deepEqual(
    h.state.regex.filter((r) => bIds.has(r.id)),
    untouchedRegex,
  );
  assert.deepEqual((await h.manager.scan()).instances.map((i) => i.version).sort(), ["2", "3"]);
  h.state.books.A.push({ uid: 77, content: "user note" });
  entries(h.state.books.A)[0].content += "edited again";
  const remove = await h.manager.preview({ action: "uninstall", instanceId: a });
  assert.ok(remove.playerChanges.length);
  await h.manager.confirm(remove.previewId);
  assert.deepEqual(entries(h.state.books.A), [persistBook({ uid: 77, content: "user note" })]);
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
  entries(h.state.books.A)[0].content += "late edit";
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
    entries(h.state.books.A)[0].content += "racing edit";
  };
  await assert.rejects(h.manager.confirm(p.previewId), /世界书已改变/);
  assert.equal(h.state.writes, writes);
  assert.ok(entries(h.state.books.A)[0].content.includes("racing edit"));
});
test("scan explicitly reports all books, failed reads and ambiguous names or malformed metadata without writes", async () => {
  const h = harness();
  h.state.books.A = [
    { uid: 1, name: "[WS] guessed", content: "x" },
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
test("legacy EJS migration and new book binding preserve unrelated rows", async () => {
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
      extra: { cw_project_id: "legacy", cw_project_version: "1", cw_entry_key: "k" },
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
  assert.equal(entries(h.state.books.New).length, 1);
  assert.deepEqual(entries(h.state.books.A), [persistBook({ uid: 5, content: "unrelated" })]);
  assert.deepEqual(h.state.bindings.additional, ["New"]);
  const scan = await h.manager.scan();
  assert.equal(scan.instances.length, 1);
  assert.equal(scan.instances[0].location.worldbook, "New");
});
test("conflicting legacy identity prevents conversion without modifying the book", async () => {
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
      extra: { cw_project_id: "other" },
    },
  ];
  const before = clone(h.state.books);
  const scan = await h.manager.scan();
  assert.ok(scan.ambiguous.some((item) => item.location.startsWith("A /")));
  await assert.rejects(
    h.manager.preview({ action: "migrate", instanceId: "legacy:legacy:book:A", targetWorldbook: "B" }),
    /存疑/,
  );
  assert.equal(h.state.writes, 0);
  assert.deepEqual(h.state.books, before);
});
test("newly installed book retains native source when persistent ownership is reused", async () => {
  const h = harness();
  const id = await install(h, "A");
  const instance = (await h.manager.scan()).instances.find((item) => item.instanceId === id);
  assert.equal(instance.source, "native");
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
  assert.equal(contentBody(entries(h.state.books.A).find((row) => row.name === "[WS] Entry")), "2");
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

test("copied YAML entries form an independent worldbook installation", async () => {
  const h = harness();
  const id = await install(h, "A");
  h.state.books.B = clone(h.state.books.A);
  const untouched = clone(h.state.books.B);
  const scan = await h.manager.scan();
  assert.deepEqual(scan.instances.map((instance) => instance.location.worldbook).sort(), ["A", "B"]);
  const preview = await h.manager.preview({ action: "uninstall", instanceId: id });
  await h.manager.confirm(preview.previewId);
  assert.deepEqual(h.state.books.B, untouched);
  assert.equal(contentBody(entries(h.state.books.B)[0]), "1");
});

test("copied legacy instance stamps at an unregistered location do not authorize deletion", async () => {
  const h = harness();
  const id = await install(h, "A");
  const row = {
    uid: 1,
    name: "legacy",
    content: "body",
    extra: {
      cw_instance_id: id,
      cw_project_id: "p",
      cw_project_version: "1",
      cw_entry_key: "legacy-key",
    },
  };
  h.state.books.A = [clone(row)];
  h.state.books.B = [clone(row)];
  const before = clone(h.state.books);
  const writes = h.state.writes;
  const scan = await h.manager.scan();
  assert.ok(scan.ambiguous.some((item) => item.reason.includes("非登记位置")));
  await assert.rejects(h.manager.preview({ action: "uninstall", instanceId: id }), /存疑/);
  assert.equal(h.state.writes, writes);
  assert.deepEqual(h.state.books, before);
});

test("official entries remain untouched; WS requires identity and installed names are marked once", async () => {
  const h = harness();
  h.state.books.A = [
    { name: "[DLC] official", content: "official" },
    { name: "[工坊] old", content: "old" },
  ];
  const preview = await h.manager.preview({
    action: "install",
    project: { id: "p", version: "1" },
    files: { worldbook: JSON.stringify({ entries: [{ name: "[WS] Entry", content: "new" }] }) },
    targetWorldbook: "A",
  });
  await h.manager.confirm(preview.previewId);
  assert.deepEqual(
    entries(h.state.books.A).map((row) => row.name),
    ["[DLC] official", "[工坊] old", "[WS] Entry"],
  );
  const remove = await h.manager.preview({ action: "uninstall", instanceId: preview.instanceId });
  await h.manager.confirm(remove.previewId);
  assert.deepEqual(
    entries(h.state.books.A).map((row) => row.name),
    ["[DLC] official", "[工坊] old"],
  );
  h.state.books.A.push({ name: "[WS] unowned", content: "unknown" });
  await assert.rejects(
    h.manager.preview({
      action: "install",
      project: { id: "p", version: "1" },
      files: files("1"),
      targetWorldbook: "A",
    }),
    /身份存疑/,
  );
});

test("ambiguous neighboring book and character-like book names do not block another location", async () => {
  const h = harness();
  const id = await install(h, "A");
  h.state.books["A-extra"] = [{ name: "[WS] unknown" }];
  h.state.books["角色:avatar.png"] = [{ name: "[WS] unknown" }];
  const preview = await h.manager.preview({ action: "uninstall", instanceId: id });
  await h.manager.confirm(preview.previewId);
  assert.equal(h.state.books["A-extra"].length, 1);
  assert.equal(h.state.books["角色:avatar.png"].length, 1);
});

test("closing a session invalidates pending and in-flight previews and confirmations before writes", async () => {
  const h = harness();
  const id = await install(h, "A");
  const pending = await h.manager.preview({ action: "uninstall", instanceId: id });
  h.manager.cancelAll();
  await assert.rejects(h.manager.confirm(pending.previewId), /取消/);
  let release;
  let entered;
  const waiting = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  h.state.beforeRead = async () => {
    entered();
    await gate;
  };
  const preparing = h.manager.preview({ action: "uninstall", instanceId: id });
  await waiting;
  h.manager.cancelAll();
  release();
  await assert.rejects(preparing, /取消/);
  h.state.beforeRead = null;
  const ready = await h.manager.preview({ action: "uninstall", instanceId: id });
  let resume;
  let started;
  const begun = new Promise((resolve) => {
    started = resolve;
  });
  const blocked = new Promise((resolve) => {
    resume = resolve;
  });
  h.state.beforeRead = async () => {
    started();
    await blocked;
  };
  const writes = h.state.writes;
  const confirming = h.manager.confirm(ready.previewId);
  await begun;
  h.manager.cancelAll();
  resume();
  await assert.rejects(confirming, /取消/);
  assert.equal(h.state.writes, writes);
});

test("updating a regex-only instance can add a worldbook", async () => {
  const h = harness();
  const first = await h.manager.preview({
    action: "install",
    project: { id: "p", version: "1" },
    files: { regex: files("1").regex },
  });
  await h.manager.confirm(first.previewId);
  const update = await h.manager.preview({
    action: "update",
    instanceId: first.instanceId,
    project: { id: "p", version: "2" },
    files: files("2"),
    targetWorldbook: "B",
  });
  await h.manager.confirm(update.previewId);
  assert.equal(entries(h.state.books.B)[0].name, "[WS] Entry");
  assert.equal((await h.manager.scan()).instances[0].location.worldbook, "B");
});

test("historical unmarked names and dynamic name references survive installation", async () => {
  const h = harness();
  const source = {
    entries: [
      { name: "Library", content: "text" },
      { name: "Caller", content: "<%- await getwi(/^Library$/) %>" },
    ],
  };
  const p = await h.manager.preview({
    action: "install",
    project: { id: "old", version: "1" },
    files: { worldbook: JSON.stringify(source) },
    targetWorldbook: "A",
  });
  await h.manager.confirm(p.previewId);
  assert.deepEqual(
    entries(h.state.books.A).map((row) => [row.name, contentBody(row)]),
    [
      ["Library", "text"],
      ["Caller", "<%- await getwi(/^Library$/) %>"],
    ],
  );
});

test("new installations write one YAML registry per book and isolate updates and removal", async () => {
  const h = harness();
  const a = await install(h, "A", "1");
  await install(h, "B", "2");
  for (const [name, version] of [
    ["A", "1"],
    ["B", "2"],
  ]) {
    const registries = h.state.books[name].filter((row) => row.name === registryName);
    assert.equal(registries.length, 1);
    const index = namespace(registries[0], "workshop_index");
    assert.equal(index.version, 1);
    assert.deepEqual(
      index.projects.map((project) => [project.project_id, project.version_id]),
      [["p", version]],
    );
    const stamp = namespace(entries(h.state.books[name])[0], "workshop_entry");
    assert.equal(stamp.version, 1);
    assert.equal(stamp.project_id, "p");
    assert.equal(stamp.version_id, version);
    assert.ok(stamp.entry_key);
  }
  const untouched = clone(h.state.books.B);
  const update = await h.manager.preview({
    action: "update",
    instanceId: a,
    project: { id: "p", version: "3" },
    files: files("3"),
  });
  await h.manager.confirm(update.previewId);
  assert.deepEqual(h.state.books.B, untouched);
  assert.equal(
    namespace(
      h.state.books.A.find((row) => row.name === registryName),
      "workshop_index",
    ).projects[0].version_id,
    "3",
  );
  const remove = await h.manager.preview({ action: "uninstall", instanceId: a });
  await h.manager.confirm(remove.previewId);
  assert.deepEqual(
    namespace(
      h.state.books.A.find((row) => row.name === registryName),
      "workshop_index",
    ).projects,
    [],
  );
  assert.deepEqual(h.state.books.B, untouched);
});

test("registry previews match the writes for installation, update, migration and removal", async () => {
  const h = harness();
  const registry = (name) => {
    const row = h.state.books[name].find((item) => item.name === registryName);
    if (!row) return null;
    const { uid: _uid, ...payload } = persistBook(row);
    return payload;
  };
  const apply = async (intent, names) => {
    const before = Object.fromEntries(names.map((name) => [name, registry(name)]));
    const preview = await h.manager.preview(intent);
    const changes = preview.changes.filter((change) => change.key.includes(" / 注册表 / "));
    assert.equal(changes.length, names.length);
    await h.manager.confirm(preview.previewId);
    for (const name of names) {
      const change = changes.find((item) => item.key.startsWith(`${name} / 注册表 / `));
      assert.ok(change, `missing registry change for ${name}`);
      assert.deepEqual(change.before === null ? null : JSON.parse(change.before), before[name]);
      assert.deepEqual(change.after === null ? null : JSON.parse(change.after), registry(name));
    }
    return preview.instanceId;
  };
  const id = await apply(
    { action: "install", project: { id: "p", version: "1" }, files: files("1"), targetWorldbook: "A" },
    ["A"],
  );
  await apply({ action: "update", instanceId: id, project: { id: "p", version: "2" }, files: files("2") }, ["A"]);
  await apply({ action: "migrate", instanceId: id, targetWorldbook: "B" }, ["A", "B"]);
  await apply({ action: "uninstall", instanceId: id }, ["B"]);
});

test("legacy conversion preserves content and other YAML namespaces, and is idempotent", async () => {
  const h = harness();
  const legacy = { cw_project_id: "old", cw_project_version: "v1", cw_entry_key: "one" };
  h.state.books.A = [
    { uid: 1, name: "old", content: "<%#\nother_namespace:\n  keep: yes\n%>body", extra: legacy },
    { uid: 2, name: "other", content: "unrelated" },
  ];
  const beforeB = clone(h.state.books.B);
  const result = await h.manager.convertLegacy(["A", "B"]);
  assert.equal(result.converted, 1);
  assert.equal(result.skipped, 0);
  const row = h.state.books.A.find((item) => item.uid === 1);
  assert.equal(namespace(row, "other_namespace").keep, "yes");
  assert.ok(row.content.includes("body"));
  assert.deepEqual(namespace(row, "workshop_entry"), {
    version: 1,
    project_id: "old",
    entry_key: "one",
    version_id: "v1",
  });
  assert.deepEqual(
    namespace(
      h.state.books.A.find((item) => item.name === registryName),
      "workshop_index",
    ).projects.map((p) => [p.project_id, p.version_id]),
    [["old", "v1"]],
  );
  assert.equal(h.state.books.A.find((item) => item.uid === 2).content, "unrelated");
  assert.deepEqual(h.state.books.B, beforeB);
  const after = clone(h.state.books);
  assert.equal((await h.manager.convertLegacy(["A", "B"])).converted, 0);
  assert.deepEqual(h.state.books, after);
});

test("legacy conversion skips conflicting identities without changing either project", async () => {
  const h = harness();
  const extra = { cw_project_id: "p", cw_project_version: "1", cw_entry_key: "same" };
  h.state.books.A = [
    { uid: 1, name: "first", content: "first", extra },
    { uid: 2, name: "second", content: "second", extra: clone(extra) },
  ];
  const before = clone(h.state.books);
  const result = await h.manager.convertLegacy(["A", "B"]);
  assert.equal(result.converted, 0);
  assert.ok(result.skipped > 0);
  assert.deepEqual(h.state.books, before);
  assert.equal(h.state.writes, 0);
});

test("legacy EJS metadata containing an EJS terminator is serialized safely as YAML", async () => {
  const h = harness();
  h.state.books.A = [
    {
      uid: 1,
      name: "old",
      content: "body",
      extra: {
        cw_project_id: "p%>unsafe",
        cw_project_version: "v1",
        cw_entry_key: "key%>unsafe",
      },
    },
  ];
  const result = await h.manager.convertLegacy(["A", "B"]);
  assert.equal(result.converted, 1);
  const row = h.state.books.A.find((item) => item.uid === 1);
  const stamp = namespace(row, "workshop_entry");
  assert.equal(stamp.project_id, "p%>unsafe");
  assert.equal(stamp.entry_key, "key%>unsafe");
  assert.equal(contentBody(row), "body");
});

test("legacy EJS metadata converts to YAML without leaving the old identity block", async () => {
  const h = harness();
  const meta = {
    cw_project_id: "p",
    cw_project_version: "v1",
    cw_entry_key: "k",
    cw_project_name_display: "P",
    cw_name_format_version: 4,
  };
  h.state.books.A = [
    {
      uid: 1,
      name: "old",
      content: `<%# poem-workshop-meta:v1-start\n${JSON.stringify(meta)}\npoem-workshop-meta:v1-end %>body`,
    },
  ];
  const result = await h.manager.convertLegacy(["A", "B"]);
  assert.equal(result.converted, 1);
  const row = h.state.books.A.find((item) => item.uid === 1);
  assert.equal(contentBody(row), "body");
  assert.ok(!row.content.includes("poem-workshop-meta:v1"));
  assert.deepEqual(namespace(row, "workshop_entry"), { version: 1, project_id: "p", entry_key: "k", version_id: "v1" });
});

test("legacy conversion rejects changed or invalid confirmed scope without writes", async () => {
  const h = harness();
  h.state.books.A = [
    { uid: 1, name: "old", content: "body", extra: { cw_project_id: "p", cw_project_version: "1", cw_entry_key: "k" } },
  ];
  const before = clone(h.state.books);
  for (const scope of [["A"], ["A", "B", "C"], ["A", "A", "B"], [], undefined]) {
    await assert.rejects(h.manager.convertLegacy(scope), /重新扫描并确认/);
    assert.deepEqual(h.state.books, before);
    assert.equal(h.state.writes, 0);
  }
  h.state.beforeRead = (name) => {
    if (name === "A") h.state.books.C = [];
  };
  await assert.rejects(h.manager.convertLegacy(["A", "B"]), /重新扫描并确认/);
  assert.deepEqual(h.state.books, { ...before, C: [] });
  assert.equal(h.state.writes, 0);
});

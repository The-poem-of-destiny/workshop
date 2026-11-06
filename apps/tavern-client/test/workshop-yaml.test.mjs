import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { parse as parseYaml } from "yaml";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-yaml-"));
const outfile = path.join(dir, "workshop-yaml.mjs");
await build({
  entryPoints: [path.resolve("src/workshop-yaml.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  outfile,
  logLevel: "silent",
});
const { entryIdentity, writeEntry, readIndex, INDEX_NAME } = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));

const id = { projectId: "project", key: "entry", version: "v1" };
const block = (body) => `<%#\n${body}\n%>`;

test("nested or literal workshop names are not root namespaces and remain intact", () => {
  const original = block("other:\n  workshop_entry: unrelated\n  text: |\n    workshop_entry: literal");
  assert.equal(entryIdentity(original), null);
  const row = writeEntry({ content: original }, id);
  assert.ok(row.content.startsWith(original));
  assert.deepEqual(entryIdentity(row.content), id);
  const bodies = [...row.content.matchAll(/<%#([\s\S]*?)%>/g)].map((match) => parseYaml(match[1]));
  assert.deepEqual(bodies[0], { other: { workshop_entry: "unrelated", text: "workshop_entry: literal\n" } });
});

test("quoted and flow-style root namespaces are recognized", () => {
  const content = block('{"workshop_entry": {version: 1, project_id: project, entry_key: entry, version_id: v1}}');
  assert.deepEqual(entryIdentity(content), id);
  const index = block('{"workshop_index": {version: 1, projects: []}}');
  assert.deepEqual(readIndex([{ name: INDEX_NAME, content: index }]), []);
});

test("damaged or duplicate root namespaces are rejected", () => {
  const valid = block("workshop_entry: {version: 1, project_id: project, entry_key: entry, version_id: v1}");
  assert.throws(() => entryIdentity(block("workshop_entry: [broken")), /损坏或重复/);
  assert.throws(() => entryIdentity(block("workshop_entry: {}\nworkshop_entry: {}")), /损坏或重复/);
  assert.throws(() => entryIdentity(`${valid}\n${valid}`), /损坏或重复/);
});

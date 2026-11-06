import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-discovery-"));
const outfile = path.join(dir, "discovery.mjs");
await build({
  entryPoints: [path.resolve("src/install-discovery.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
});
const { discover } = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));

const meta = { cw_project_id: "p", cw_project_version: "1", cw_entry_key: "k" };
const ejs = (identity) =>
  `<%# poem-workshop-meta:v1-start\n${JSON.stringify({ ...identity, cw_project_name_display: "P", cw_name_format_version: 4 })}\npoem-workshop-meta:v1-end %>body`;
const scan = (row) =>
  discover({
    names: ["A"],
    character: null,
    books: new Map([["A", [row]]]),
    regex: [],
    failures: [],
    bindings: {},
    records: {},
  });

test("conflicting legacy identity carriers make the whole book ambiguous without changing legacy lookup", () => {
  for (const row of [
    { content: ejs(meta), extra: { ...meta, cw_project_id: "other" } },
    { content: "body", extra: meta, extensions: { ...meta, cw_entry_key: "other" } },
    { content: ejs(meta), extensions: { ...meta, cw_project_version: "2" } },
    { content: "body", extra: { ...meta, cw_instance_id: "one" }, extensions: { ...meta, cw_instance_id: "two" } },
  ]) {
    const result = scan(row);
    assert.ok(result.ambiguousBooks.has("A"));
    assert.ok(result.scan.ambiguous.some((item) => item.location.startsWith("A /")));
  }
  assert.equal(scan({ content: ejs(meta), extra: meta, extensions: meta }).ambiguousBooks.size, 0);
  assert.equal(scan({ content: ejs(meta), extra: { unrelated: true } }).ambiguousBooks.size, 0);
});

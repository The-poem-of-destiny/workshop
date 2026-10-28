import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-client-lib-"));
const outfile = path.join(dir, "lib.mjs");
await build({
  entryPoints: [path.resolve("src/lib.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const lib = await import(pathToFileURL(outfile).href);

test("entry keys prefer explicit project keys, then uid, then index", () => {
  assert.equal(lib.entryKey({ uid: 4, extensions: { cw_entry_key: "uid:4" } }, 0), "uid:4");
  assert.equal(lib.entryKey({ uid: "x" }, 0), "uid:x");
  assert.equal(lib.entryKey({ extensions: { cw_entry_id: 9 } }, 0), "uid:9");
  assert.equal(lib.entryKey({ comment: "no id" }, 7), "index:7");
});

test("worldbook and regex containers normalize to entry arrays", () => {
  assert.equal(lib.worldbookEntries({ entries: [{ uid: 1 }] }).length, 1);
  assert.equal(lib.worldbookEntries({ entries: { a: { uid: 1 }, b: { uid: 2 } } }).length, 2);
  assert.equal(lib.worldbookEntries([]).length, 0);
  assert.equal(lib.regexEntries({ regex_scripts: [{ scriptName: "x" }] }).length, 1);
  assert.equal(lib.regexEntries({ scriptName: "single" }).length, 1);
});

test("workshop origins normalize to scheme and host and reject invalid schemes", () => {
  assert.equal(
    lib.normalizeWorkshopOrigin("https://workshop.example/path?x=1", "https://fallback.example"),
    "https://workshop.example",
  );
  assert.equal(
    lib.normalizeWorkshopOrigin("http://127.0.0.1:8787/", "https://fallback.example"),
    "http://127.0.0.1:8787",
  );
  assert.equal(
    lib.normalizeWorkshopOrigin("javascript:alert(1)", "https://fallback.example"),
    "https://fallback.example",
  );
  assert.equal(lib.normalizeWorkshopOrigin("", "https://fallback.example"), "https://fallback.example");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

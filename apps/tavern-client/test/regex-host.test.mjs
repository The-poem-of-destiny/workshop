import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { regex } from "./host-fixture.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-regex-host-"));
const outfile = path.join(dir, "host.mjs");
await build({
  entryPoints: [path.resolve("src/regex-host.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile,
  logLevel: "silent",
});
const { characterRegexHost } = await import(pathToFileURL(outfile).href);
after(() => rm(dir, { recursive: true, force: true }));
test("actual TH legacy scope branch is never selected by the production adapter", async () => {
  let stored = [];
  const get = (options) => {
    const rows = stored.map(regex);
    // Real TH decorates old scope results; modern type results have no scope field.
    return options.scope ? rows.map((row) => ({ ...row, scope: options.scope })) : rows;
  };
  const host = characterRegexHost(
    (options) => {
      assert.deepEqual(options, { type: "character", enable_state: "all" });
      return get(options);
    },
    async (update, options) => {
      assert.deepEqual(options, { type: "character" });
      stored = update(get(options)).map(regex);
    },
  );
  const desired = regex({ id: "uuid", enabled: true, script_name: "R", find_regex: "x", replace_string: "y" });
  await host.updateRegex(() => [desired]);
  assert.deepEqual(host.regex(), [desired]);
  assert.equal(host.regex()[0].scope, undefined);
  assert.equal(get({ scope: "character" })[0].scope, "character");
});

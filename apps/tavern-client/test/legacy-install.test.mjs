import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const dir = await mkdtemp(path.join(os.tmpdir(), "cw-legacy-install-"));
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
test("reliable old encoded regex identities remain a distinct character instance and delete wholly", async () => {
  let regex = [
    { id: "creative_workshop:p:v1:key%3A1:2", find_regex: "edited", script_name: "old" },
    { id: "user", find_regex: "user" },
  ];
  let records = {};
  let writes = 0;
  const manager = createInstallManager({
    character: () => "avatar",
    names: () => [],
    bindings: () => ({ primary: null, additional: [] }),
    book: async () => [],
    regex: () => structuredClone(regex),
    records: () => records,
    uuid: () => "preview",
    updateBook: async () => {
      throw new Error("unexpected book write");
    },
    updateRegex: async (update) => {
      regex = update(regex);
      writes++;
    },
    createBook: async () => {
      throw new Error("unexpected create");
    },
    bind: async () => {
      throw new Error("unexpected bind");
    },
    saveRecords: async (value) => {
      records = value;
      writes++;
    },
  });
  const scan = await manager.scan();
  assert.equal(scan.instances.length, 1);
  assert.equal(scan.instances[0].version, "2");
  assert.equal(scan.instances[0].location.worldbook, null);
  const p = await manager.preview({ action: "uninstall", instanceId: scan.instances[0].instanceId });
  assert.ok(p.playerChanges.length);
  assert.equal(writes, 0);
  await manager.confirm(p.previewId);
  assert.deepEqual(regex, [{ id: "user", find_regex: "user" }]);
});

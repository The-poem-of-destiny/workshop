import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkArchitecture } from "./check-architecture.mjs";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "workshop-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(file, contents) {
    const target = path.join(root, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const [dir, name] of Object.entries({
    "apps/worker": "worker",
    "apps/tavern-client": "tavern-client",
    "packages/contracts": "contracts",
    "packages/domain": "domain",
    "packages/content": "content",
  }))
    put(`${dir}/package.json`, JSON.stringify({ name: `@workshop/${name}` }));
  return { root, put };
}

test("enforces manifest direction in all dependency sections", (t) => {
  const { root, put } = fixture(t);
  put(
    "packages/domain/package.json",
    JSON.stringify({ name: "@workshop/domain", devDependencies: { "@workshop/contracts": "workspace:*" } }),
  );
  assert.match(checkArchitecture(root).join("\n"), /forbidden devDependencies dependency on @workshop\/contracts/);
});

test("checks source imports, reexports, dynamic imports and relative paths", (t) => {
  const { root, put } = fixture(t);
  put("packages/contracts/src/index.ts", "export const x = 1;");
  put(
    "packages/domain/src/index.ts",
    `import { x } from "../../contracts/src/index.js";\nexport * from "@workshop/content";\nimport("@workshop/worker");\nrequire(variable);`,
  );
  const result = checkArchitecture(root).join("\n");
  assert.match(result, /forbidden dependency on '..\/..\/contracts\/src\/index.js'/);
  assert.match(result, /forbidden dependency on '@workshop\/content'/);
  assert.match(result, /forbidden dependency on '@workshop\/worker'/);
  assert.match(result, /dynamic module specifiers/);
});

test("allows shared contracts and type-only storage contracts but blocks reverse runtime edges", (t) => {
  const { root, put } = fixture(t);
  put("packages/contracts/src/install.ts", "export interface Install {};");
  put("apps/tavern-client/src/index.ts", 'import type { Install } from "../../../packages/contracts/src/install.js";');
  put("apps/worker/src/data/contracts.ts", "export interface Contract {};");
  put("apps/worker/src/storage/ok.ts", 'import type { Contract } from "../data/contracts.js";');
  assert.deepEqual(checkArchitecture(root), []);
  put("apps/worker/src/storage/bad.ts", 'export * from "../data/contracts.js";');
  put("apps/worker/web/src/bad.ts", 'import "../../src/data/contracts.js";');
  const result = checkArchitecture(root).join("\n");
  assert.match(result, /storage may only import data contracts as types/);
  assert.match(result, /Web cannot import Worker implementation/);
});

test("resolves TypeScript path aliases before checking boundaries", (t) => {
  const { root, put } = fixture(t);
  put(
    "packages/domain/tsconfig.json",
    JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@other/*": ["../contracts/src/*"] } } }),
  );
  put("packages/contracts/src/index.ts", "export const x = 1;");
  put("packages/domain/src/index.ts", 'export { x } from "@other/index";');
  assert.match(checkArchitecture(root).join("\n"), /forbidden dependency on '@other\/index'/);
});

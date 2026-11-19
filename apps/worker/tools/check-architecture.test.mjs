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

test("allows shared contracts and type-only storage/web contracts but blocks reverse runtime or relative cross-workspace edges", (t) => {
  const { root, put } = fixture(t);
  put(
    "apps/tavern-client/package.json",
    JSON.stringify({ name: "@workshop/tavern-client", devDependencies: { "@workshop/contracts": "workspace:*" } }),
  );
  put(
    "apps/tavern-client/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@workshop/contracts": ["../../packages/contracts/src/index.ts"] } },
    }),
  );
  put(
    "apps/worker/web/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@workshop/contracts": ["../../../packages/contracts/src/index.ts"] } },
    }),
  );
  put("packages/contracts/src/index.ts", "export interface Install {}; export const installSchema = 1;");
  put("apps/tavern-client/src/index.ts", 'import type { Install } from "@workshop/contracts";');
  put("apps/worker/web/src/ok.ts", 'import type { Install } from "@workshop/contracts";');
  put("apps/worker/src/data/contracts.ts", "export interface Contract {};");
  put("apps/worker/src/storage/ok.ts", 'import type { Contract } from "../data/contracts.js";');
  assert.deepEqual(checkArchitecture(root), []);
  put("apps/tavern-client/src/relative.ts", 'import type { Install } from "../../../packages/contracts/src/index.js";');
  put("apps/worker/src/storage/bad.ts", 'export * from "../data/contracts.js";');
  put("apps/worker/web/src/bad.ts", 'import "../../src/data/contracts.js";');
  put("apps/worker/web/src/runtime-contract.ts", 'import { installSchema } from "@workshop/contracts";');
  const result = checkArchitecture(root).join("\n");
  assert.match(result, /cross-workspace relative import is forbidden/);
  assert.match(result, /storage may only import data contracts as types/);
  assert.match(result, /Web cannot import Worker implementation/);
  assert.match(result, /Web may only import contracts as types/);
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

test("checks resolved paths even when an alias matches a workspace package name", (t) => {
  const { root, put } = fixture(t);
  put("apps/worker/src/data/contracts.ts", "export interface Contract {}");
  put(
    "apps/worker/web/tsconfig.json",
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@workshop/contracts": ["../src/data/contracts.ts"] } },
    }),
  );
  put("apps/worker/web/src/index.ts", 'import type { Contract } from "@workshop/contracts";');
  assert.match(checkArchitecture(root).join("\n"), /Web cannot import Worker implementation '@workshop\/contracts'/);
});

test("distinguishes erased type declarations from runtime imports and exports", (t) => {
  const { root, put } = fixture(t);
  put("apps/worker/src/data/contracts.ts", "export interface Contract {}");
  put(
    "apps/worker/src/storage/types.ts",
    'import type { Contract } from "../data/contracts.js";\nexport type { Contract } from "../data/contracts.js";\ntype Other = import("../data/contracts.js").Contract;',
  );
  assert.deepEqual(checkArchitecture(root), []);
  put(
    "apps/worker/src/storage/runtime.ts",
    'import {} from "../data/contracts.js";\nimport { type Contract } from "../data/contracts.js";\nexport { type Contract } from "../data/contracts.js";',
  );
  const errors = checkArchitecture(root);
  assert.equal(errors.length, 3);
  for (const error of errors) assert.match(error, /storage may only import data contracts as types/);
});

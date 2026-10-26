#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";

const failures = [];
const read = (path) => readFileSync(path, "utf8");

const required = [
  "pnpm-workspace.yaml",
  "apps/worker/package.json",
  "apps/worker/tsconfig.json",
  "apps/worker/migrations/0001_initial.sql",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
  ".nvmrc",
  "biome.json",
  "docs/AGENTS.md",
  ".agents/AGENTS.md",
  ".agents/notes/README.md",
  ".agents/notes/AGENTS.md",
  ".agents/skills/AGENTS.md",
  ".agents/skills/autonomous-refactor/SKILL.md",
];

for (const path of required) {
  try {
    read(path);
  } catch {
    failures.push(`missing ${path}`);
  }
}

const workerTsconfig = JSON.parse(read("apps/worker/tsconfig.json"));
if (workerTsconfig.compilerOptions?.strict !== true) {
  failures.push("apps/worker/tsconfig.json must set strict: true");
}

const contractsTsconfig = JSON.parse(read("packages/contracts/tsconfig.json"));
if (contractsTsconfig.compilerOptions?.strict !== true) {
  failures.push("packages/contracts/tsconfig.json must set strict: true");
}

const rootPackage = JSON.parse(read("package.json"));
for (const script of ["check", "check:workspace", "check:schema", "worker:test", "lint", "format", "format:check"]) {
  if (!rootPackage.scripts?.[script]) failures.push(`package.json missing script ${script}`);
}
if (rootPackage.engines?.node !== ">=22") {
  failures.push("package.json must set engines.node >=22");
}

// Every discovered package must be classified here. `true` requires a real
// script; a reason exempts that script only while it remains absent. Keep the
// policy and its exemptions together so new packages cannot silently skip CI.
const workspaceChecks = {
  "apps/worker": { typecheck: true, test: true },
  "apps/tavern-client": { typecheck: true, test: true },
  "packages/contracts": {
    typecheck: true,
    test: "Schemas are exercised by domain/worker consumers; this package has no standalone tests.",
  },
  "packages/content": {
    typecheck: "JavaScript package with declaration files; behavior is checked by its Node tests.",
    test: true,
  },
  "packages/domain": { typecheck: true, test: true },
};

// Deliberately accept only the workspace's simple directory/* YAML entries.
// Fail closed if that syntax changes instead of silently discovering fewer
// packages than pnpm. Non-package directories under a glob are not workspaces.
const workspaceEntries = [];
let inPackages = false;
let packageSections = 0;
for (const line of read("pnpm-workspace.yaml").split(/\r?\n/)) {
  // Blank lines and comments, including unindented ones, never end a list.
  if (!line.trim() || line.trimStart().startsWith("#")) continue;
  if (/^[^\s-]/.test(line)) {
    if (!/^[\w-]+:/.test(line)) {
      failures.push(`unsupported workspace configuration: ${line}; update workspace discovery`);
    }
    inPackages = /^packages:/.test(line);
    if (inPackages) {
      packageSections += 1;
      if (!/^packages:[ \t]*(?:#.*)?$/.test(line)) {
        failures.push("unsupported packages declaration; use a block list");
      }
    }
    continue;
  }
  if (inPackages) workspaceEntries.push(line);
}
const discoveredWorkspaces = new Set();
if (packageSections !== 1 || workspaceEntries.length === 0) {
  failures.push("pnpm-workspace.yaml must declare exactly one nonempty packages block list");
}
for (const line of workspaceEntries) {
  const pattern = line.match(/^\s*-\s+(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*(?:#.*)?$/);
  const value = pattern?.[1] ?? pattern?.[2] ?? pattern?.[3];
  if (!value || !/^[\w-]+(?:\/[\w-]+)*\/\*$/.test(value)) {
    failures.push(`unsupported workspace entry: ${line.trim()}; update workspace discovery`);
    continue;
  }
  const parent = value.slice(0, -2);
  if (!existsSync(parent)) {
    failures.push(`workspace directory missing: ${parent}`);
    continue;
  }
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    const directory = `${parent}/${entry.name}`;
    if ((entry.isDirectory() || entry.isSymbolicLink()) && existsSync(`${directory}/package.json`)) {
      discoveredWorkspaces.add(directory);
    }
  }
}

for (const directory of discoveredWorkspaces) {
  const manifest = JSON.parse(read(`${directory}/package.json`));
  const checks = Object.hasOwn(workspaceChecks, directory) ? workspaceChecks[directory] : undefined;
  if (!checks) {
    failures.push(`${directory}: unclassified workspace; declare typecheck/test requirements or justified exemptions`);
    continue;
  }
  for (const script of ["typecheck", "test"]) {
    const requirement = checks[script];
    const command = manifest.scripts?.[script];
    const hasScript = typeof command === "string" && command.trim().length > 0;
    if (requirement === true) {
      if (!hasScript) failures.push(`${directory}/package.json missing script ${script}`);
    } else if (typeof requirement !== "string" || !requirement.trim()) {
      failures.push(`${directory}: ${script} exemption requires a reason`);
    } else if (hasScript) {
      failures.push(`${directory}: stale ${script} exemption; require the existing script instead`);
    } else if (script === "typecheck" && existsSync(`${directory}/tsconfig.json`)) {
      failures.push(`${directory}: stale typecheck exemption; tsconfig.json now exists`);
    }
  }
}
for (const directory of Object.keys(workspaceChecks)) {
  if (!discoveredWorkspaces.has(directory)) {
    failures.push(`${directory}: stale workspace policy; package is no longer discovered`);
  }
}

const gitignore = read(".gitignore");
if (!gitignore.includes("data_backup/")) {
  failures.push(".gitignore must exclude data_backup/");
}

const agents = read("AGENTS.md");
if (!agents.includes("docs/AGENTS.md")) {
  failures.push("AGENTS.md does not point to docs/AGENTS.md");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("workspace check ok");

#!/usr/bin/env node
import { readFileSync } from "node:fs";

const failures = [];
const read = path => readFileSync(path, "utf8");

const required = [
  "pnpm-workspace.yaml",
  "apps/worker/package.json",
  "apps/worker/tsconfig.json",
  "apps/worker/migrations/0001_initial.sql",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
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
for (const script of ["check", "check:workspace", "check:schema", "worker:test"]) {
  if (!rootPackage.scripts?.[script]) failures.push(`package.json missing script ${script}`);
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

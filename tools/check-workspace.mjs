#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";

const failures = [];
const read = (path) => readFileSync(path, "utf8");

const tsconfigFiles = [
  "apps/worker/tsconfig.json",
  "apps/worker/web/tsconfig.json",
  "apps/tavern-client/tsconfig.json",
  "packages/contracts/tsconfig.json",
  "packages/domain/tsconfig.json",
];

const required = [
  "pnpm-workspace.yaml",
  "apps/worker/package.json",
  "apps/worker/migrations/0001_initial.sql",
  "packages/contracts/package.json",
  ...tsconfigFiles,
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

const requiredCompilerOptions = [
  "strict",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noFallthroughCasesInSwitch",
];
for (const tsconfigPath of tsconfigFiles) {
  if (!existsSync(tsconfigPath)) continue;
  const parsed = JSON.parse(read(tsconfigPath));
  for (const option of requiredCompilerOptions) {
    if (parsed.compilerOptions?.[option] !== true) {
      failures.push(`${tsconfigPath} must set compilerOptions.${option}: true`);
    }
  }
}

const rootPackage = JSON.parse(read("package.json"));
for (const script of ["check", "check:workspace", "check:schema", "worker:test", "lint", "format", "format:check"]) {
  if (!rootPackage.scripts?.[script]) failures.push(`package.json missing script ${script}`);
}
if (rootPackage.engines?.node !== ">=22.12.0") {
  failures.push("package.json must set engines.node >=22.12.0");
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

function discoverWorkspaces() {
  // Deliberately accept only the workspace's simple directory/* YAML entries.
  // Fail closed if that syntax changes instead of silently discovering fewer
  // packages than pnpm. Non-package directories under a glob are not workspaces.
  const entries = [];
  let inPackages = false;
  let sections = 0;
  for (const line of read("pnpm-workspace.yaml").split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (/^[^\s-]/.test(line)) {
      if (!/^[\w-]+:/.test(line)) {
        failures.push(`unsupported workspace configuration: ${line}; update workspace discovery`);
      }
      inPackages = /^packages:/.test(line);
      if (inPackages) {
        sections += 1;
        if (!/^packages:[ \t]*(?:#.*)?$/.test(line)) {
          failures.push("unsupported packages declaration; use a block list");
        }
      }
      continue;
    }
    if (inPackages) entries.push(line);
  }
  if (sections !== 1 || entries.length === 0) {
    failures.push("pnpm-workspace.yaml must declare exactly one nonempty packages block list");
  }
  const discovered = new Set();
  for (const line of entries) {
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
        discovered.add(directory);
      }
    }
  }
  return discovered;
}

function checkWorkspacePackages(discoveredWorkspaces) {
  for (const directory of discoveredWorkspaces) {
    const manifest = JSON.parse(read(`${directory}/package.json`));
    const checks = Object.hasOwn(workspaceChecks, directory) ? workspaceChecks[directory] : undefined;
    if (!checks) {
      failures.push(
        `${directory}: unclassified workspace; declare typecheck/test requirements or justified exemptions`,
      );
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
}

const SKIP_DIRS = new Set(["node_modules", ".wrangler", "dist", "build", "__pycache__", "vendor", "data_backup"]);

function walkFiles(dir, predicate, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const relPath = posix.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(relPath, predicate, results);
    else if (entry.isFile() && predicate(relPath, entry.name)) results.push(relPath);
  }
  return results;
}

function checkToolTestsWired(checkScript) {
  const testPattern = /^(?:test|test-.*)\.(?:py|mjs)$|\.(?:test|spec)\.mjs$/;
  for (const testFile of walkFiles("tools", (_rel, name) => testPattern.test(name))) {
    const escaped = testFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`).test(checkScript)) {
      failures.push(`orphaned tools test not wired into package.json scripts.check: ${testFile}`);
    }
  }
}

function checkMarkdownRelativeLinks() {
  const mdFiles = ["README.md", "docs/AGENTS.md"];
  for (const tree of ["apps", "packages", "tools"]) {
    walkFiles(tree, (_rel, name) => name === "README.md", mdFiles);
  }
  for (const docSection of [
    "docs/reference",
    "docs/guides",
    "docs/operations",
    "docs/plans",
    "docs/audits",
    ".agents",
  ]) {
    walkFiles(docSection, (rel, name) => name.endsWith(".md") && !/(?:^|\/)archive(?:d)?\//.test(rel), mdFiles);
  }
  for (const mdFile of mdFiles) {
    if (!existsSync(mdFile)) continue;
    const stripped = read(mdFile)
      .replace(/^(?:`{3,}|~{3,})[\s\S]*?^(?:`{3,}|~{3,})[ \t]*$/gm, "")
      .replace(/`[^`\n]+`/g, "code");
    for (const match of stripped.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const raw = match[1].trim().replace(/^<|>$/g, "").split(/\s+/)[0] ?? "";
      if (!raw || raw.startsWith("#") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) continue;
      const targetPath = decodeURIComponent(raw.split("#")[0].split("?")[0]);
      if (!targetPath) continue;
      if (!existsSync(resolve(dirname(mdFile), targetPath))) {
        failures.push(`${mdFile}: broken relative link ${raw}`);
      }
    }
  }
}

checkWorkspacePackages(discoverWorkspaces());
checkToolTestsWired(rootPackage.scripts?.check ?? "");
checkMarkdownRelativeLinks();

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

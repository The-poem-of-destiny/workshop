import assert from "node:assert/strict";

export const manifestPath = "apps/worker/package.json";
export const requiredChecks = ["check", "e2e", "secrets"];
const botId = 49699333;
const sha = /^[a-f0-9]{40}$/;

function version(value) {
  assert.equal(typeof value, "string", "Missing version");
  assert.match(value, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "Only stable exact semver is understood");
  return value.split(".").map(BigInt);
}

export function validateProtection(branch, viewerRule) {
  assert.equal(branch?.protected, true, "Main must be protected");
  const checks = branch?.protection?.required_status_checks;
  assert.equal(checks?.enforcement_level, "everyone", "Required checks must apply to everyone");
  assert.ok(Array.isArray(checks.contexts), "Missing required check contexts");
  assert.deepEqual([...checks.contexts].sort(), [...requiredChecks].sort(), "Unreviewed required checks");
  assert.ok(Array.isArray(checks.checks), "Missing required check providers");
  assert.equal(checks.checks.length, requiredChecks.length);
  for (const name of requiredChecks) {
    assert.ok(
      checks.checks.some((check) => check.context === name && check.app_id === 15368),
      `Required ${name} must be bound to GitHub Actions`,
    );
  }
  assert.equal(viewerRule?.allowsForcePushes, false, "Force pushes are forbidden");
  assert.equal(viewerRule?.allowsDeletions, false, "Branch deletion is forbidden");
  assert.equal(viewerRule?.requiredApprovingReviewCount, 0, "Unreviewed required approval policy");
  assert.ok(Array.isArray(viewerRule?.requiredStatusCheckContexts), "Missing viewer required check contexts");
  assert.deepEqual(
    [...viewerRule.requiredStatusCheckContexts].sort(),
    [...requiredChecks].sort(),
    "Unreviewed viewer required checks",
  );
  // Strictness, admin enforcement and other actors' bypass grants remain owner-audited baseline settings.
}

export function validateSource(pr, commit, repository, mainSha) {
  assert.equal(pr.state, "open");
  assert.equal(pr.draft, false);
  assert.equal(pr.user?.id, botId);
  assert.equal(pr.user?.login, "dependabot[bot]");
  assert.equal(pr.user?.type, "Bot");
  assert.equal(pr.head?.repo?.full_name, repository, "Forks are forbidden");
  assert.equal(pr.base?.repo?.full_name, repository);
  assert.equal(pr.base.ref, "main");
  assert.equal(pr.base.sha, mainSha, "PR must be based on current main");
  assert.match(pr.head.sha, sha);
  assert.match(pr.head.ref, /^dependabot\/npm_and_yarn\//);
  assert.equal(pr.commits, 1, "Only a single verified bot commit is supported");
  assert.equal(commit.sha, pr.head.sha);
  assert.equal(commit.author?.id, botId);
  assert.equal(commit.author?.login, "dependabot[bot]");
  assert.equal(commit.commit?.verification?.verified, true, "Verified bot signature required");
  assert.equal(commit.commit.verification.reason, "valid");
  assert.deepEqual(
    commit.parents.map((parent) => parent.sha),
    [mainSha],
    "No hidden ancestry",
  );
}

export function validateChanges(files, beforeManifest, afterManifest, beforeLock, afterLock) {
  assert.equal(files.length, 2, "Only manifest plus lockfile are allowed");
  assert.deepEqual(files.map((file) => file.filename).sort(), [manifestPath, "pnpm-lock.yaml"].sort());
  for (const file of files) {
    assert.equal(file.status, "modified");
    assert.equal(file.previous_filename, undefined);
  }
  const before = JSON.parse(beforeManifest);
  const after = JSON.parse(afterManifest);
  const from = before.dependencies?.hono;
  const to = after.dependencies?.hono;
  assert.equal(typeof from, "string");
  assert.equal(typeof to, "string");
  assert.match(from, /^\^\d+\.\d+\.\d+$/);
  assert.match(to, /^\^\d+\.\d+\.\d+$/);
  const oldVersion = from.slice(1);
  const newVersion = to.slice(1);
  const oldParts = version(oldVersion);
  const newParts = version(newVersion);
  assert.ok(
    oldParts[0] === newParts[0] && oldParts[1] === newParts[1] && newParts[2] > oldParts[2],
    "Only increasing patch updates are allowed",
  );
  after.dependencies.hono = from;
  assert.deepEqual(after, before, "Grouped dependencies, scripts, registry and manifest policy must not change");
  // hono is deliberately the sole leaf-package allowlist. No general YAML parser or
  // PR dependency installation: accept only the current canonical pnpm leaf shape.
  const escapeVersion = (value) => value.replaceAll(".", "\\.");
  const block = (value) =>
    new RegExp(
      `^  hono@${escapeVersion(value)}:\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/]+={0,2})\\}\\n    engines: \\{node: '>=16\\.9\\.0'\\}\\n`,
      "m",
    );
  const oldBlock = beforeLock.match(block(oldVersion));
  const newBlock = afterLock.match(block(newVersion));
  assert.ok(oldBlock && newBlock, "Unknown leaf package metadata");
  assert.notEqual(oldBlock[1], newBlock[1], "Updated tarball integrity required");
  assert.ok(!beforeLock.includes(`hono@${newVersion}:`), "Ambiguous existing target");
  assert.ok(!afterLock.includes(`hono@${oldVersion}:`), "Old resolution retained");
  const restored = afterLock.replace(newBlock[1], oldBlock[1]).replaceAll(newVersion, oldVersion);
  assert.equal(restored, beforeLock, "Lockfile changes outside the allowlisted leaf are forbidden");
  // Ensure global substitution cannot accidentally authorize another package bump.
  assert.equal(beforeLock.split(oldVersion).length - 1, 4, "Unexpected version collision or lockfile shape");
  assert.equal(afterLock.split(newVersion).length - 1, 4, "Unexpected version collision or lockfile shape");
  assert.ok(beforeLock.includes(`      hono:\n        specifier: ^${oldVersion}\n        version: ${oldVersion}\n`));
  assert.ok(beforeLock.includes(`  hono@${oldVersion}: {}`));
  return { name: "hono", oldVersion, newVersion };
}

export function validateSecurity(alerts, update, pr) {
  assert.equal(alerts.pageInfo?.hasNextPage, false, "Truncated alert data");
  assert.ok(Array.isArray(alerts.nodes));
  const linked = alerts.nodes.filter((alert) => alert?.dependabotUpdate?.pullRequest?.number === pr.number);
  assert.ok(linked.length > 0, "No GitHub security alert links this PR");
  for (const alert of linked) {
    assert.equal(alert.state, "OPEN");
    assert.equal(alert.dependabotUpdate.pullRequest.headRefOid, pr.head.sha, "Alert head drift");
    assert.equal(alert.vulnerableManifestPath, "pnpm-lock.yaml");
    assert.equal(alert.vulnerableRequirements, `= ${update.oldVersion}`, "Ambiguous vulnerable installed version");
    assert.equal(alert.securityVulnerability?.package?.name, update.name, "Grouped/unallowlisted security dependency");
    assert.equal(alert.securityVulnerability.package.ecosystem, "NPM");
    assert.equal(
      alert.securityVulnerability.firstPatchedVersion?.identifier,
      update.newVersion,
      "Only the exact first patched version is supported",
    );
    assert.equal(alert.securityAdvisory?.withdrawnAt, null);
    assert.match(alert.securityAdvisory?.ghsaId ?? "", /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
  }
}

export function validateChecks(checks, headSha) {
  for (const name of requiredChecks) {
    const matching = checks.filter((check) => check.name === name);
    assert.equal(matching.length, 1, `Missing or ambiguous ${name}`);
    assert.equal(matching[0].head_sha, headSha, `Stale ${name}`);
    assert.equal(matching[0].app?.id, 15368, `Untrusted ${name} provider`);
    assert.equal(matching[0].status, "completed");
    assert.equal(matching[0].conclusion, "success", `Required ${name} did not pass`);
  }
}

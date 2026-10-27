import assert from "node:assert/strict";
import { appendFile } from "node:fs/promises";
import {
  validateChanges,
  validateChecks,
  validateProtection,
  validateSecurity,
  validateSource,
} from "./dependency-update-policy.mjs";

const repository = process.env.GITHUB_REPOSITORY;
assert.match(repository ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
assert.equal(process.env.GITHUB_REF, "refs/heads/main", "Run trusted policy on main only");
const [owner, name] = repository.split("/");
const root = `/repos/${repository}`;
const token = process.env.GH_TOKEN;
assert.ok(token);

async function api(path, body, method = body ? "POST" : "GET") {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok, `GitHub API ${method} ${path}: ${response.status}`);
  if (response.status === 204) return null;
  const data = await response.json();
  assert.ok(!data.errors, `GraphQL request failed: ${JSON.stringify(data.errors)}`);
  return data;
}

async function graphql(query, variables) {
  return (await api("/graphql", { query, variables })).data;
}

async function list(path) {
  const data = await api(`${path}${path.includes("?") ? "&" : "?"}per_page=100`);
  assert.ok(Array.isArray(data) && data.length < 100, "Truncated or malformed API listing");
  return data;
}

async function allOpenPulls() {
  const pulls = [];
  for (let page = 1; ; page += 1) {
    const batch = await api(`${root}/pulls?state=open&base=main&per_page=100&page=${page}`);
    assert.ok(Array.isArray(batch), "Malformed recovery PR listing");
    pulls.push(...batch);
    if (batch.length < 100) return pulls;
  }
}

async function protection() {
  const data = await graphql(
    `query($owner:String!,$name:String!) {
    repository(owner:$owner,name:$name) {
      autoMergeAllowed
      ref(qualifiedName:"refs/heads/main") { target { oid } branchProtectionRule {
        requiresStatusChecks requiresStrictStatusChecks isAdminEnforced allowsForcePushes allowsDeletions
        requiredStatusCheckContexts requiredStatusChecks { context app { databaseId } }
        bypassPullRequestAllowances(first:1) { totalCount }
      } }
    }
  }`,
    { owner, name },
  );
  if (process.env.DEPENDENCY_SECURITY_AUTOMERGE === "true") {
    assert.equal(data.repository.autoMergeAllowed, true, "Repository auto-merge is not enabled");
  }
  validateProtection(data.repository.ref.branchProtectionRule);
  return data.repository.ref.target.oid;
}

async function content(path, ref) {
  const file = await api(`${root}/contents/${path}?ref=${ref}`);
  assert.equal(file.type, "file");
  assert.equal(file.encoding, "base64");
  assert.ok(file.size < 1_000_000, "Oversized dependency input");
  return Buffer.from(file.content, "base64").toString("utf8");
}

async function dispatch(pr) {
  assert.equal(pr.merged, true);
  assert.match(pr.merge_commit_sha ?? "", /^[a-f0-9]{40}$/);
  const main = await api(`${root}/git/ref/heads/main`);
  assert.equal(
    main.object.sha,
    pr.merge_commit_sha,
    "Main advanced: do not dispatch a different revision; inspect main CI manually",
  );
  await api(`${root}/actions/workflows/ci.yml/dispatches`, {
    ref: "main",
    inputs: { expected_sha: pr.merge_commit_sha },
  });
  console.log(
    `Dispatched main CI for merged PR #${pr.number} at ${pr.merge_commit_sha}; staging remains gated by successful ci workflow_run.`,
  );
}

async function disable(id) {
  await graphql(
    "mutation($id:ID!) { disablePullRequestAutoMerge(input:{pullRequestId:$id}) { pullRequest { number } } }",
    { id },
  );
}

let mutationStarted = false;

async function alerts() {
  const data = await graphql(
    `query($owner:String!,$name:String!) { repository(owner:$owner,name:$name) {
    vulnerabilityAlerts(first:100) { pageInfo { hasNextPage } nodes {
      state vulnerableManifestPath vulnerableRequirements
      dependabotUpdate { pullRequest { number headRefOid } }
      securityVulnerability { package { name ecosystem } firstPatchedVersion { identifier } }
      securityAdvisory { ghsaId withdrawnAt }
    } }
  } }`,
    { owner, name },
  );
  const result = data.repository.vulnerabilityAlerts;
  assert.equal(result?.pageInfo?.hasNextPage, false, "Truncated alert listing");
  assert.ok(Array.isArray(result.nodes), "Missing alert access");
  return result;
}

async function mergeAuthorization(number) {
  const data = await graphql(
    `query($owner:String!,$name:String!,$number:Int!) { repository(owner:$owner,name:$name) {
      pullRequest(number:$number) { id autoMergeRequest { enabledBy { login } } }
    } }`,
    { owner, name, number },
  );
  return data.repository.pullRequest;
}

async function evaluate(number) {
  mutationStarted = false;
  const pr = await api(`${root}/pulls/${number}`);
  const mainSha = await protection();
  const commit = await api(`${root}/commits/${pr.head.sha}`);
  validateSource(pr, commit, repository, mainSha);
  const files = await list(`${root}/pulls/${number}/files`);
  assert.equal(files.length, pr.changed_files, "Truncated file listing");
  const [beforeManifest, afterManifest, beforeLock, afterLock] = await Promise.all([
    content("apps/worker/package.json", mainSha),
    content("apps/worker/package.json", pr.head.sha),
    content("pnpm-lock.yaml", mainSha),
    content("pnpm-lock.yaml", pr.head.sha),
  ]);
  const update = validateChanges(files, beforeManifest, afterManifest, beforeLock, afterLock);
  validateSecurity(await alerts(), update, pr);
  const checks = await api(`${root}/commits/${pr.head.sha}/check-runs?per_page=100&filter=latest`);
  assert.ok(checks.total_count < 100 && checks.check_runs.length === checks.total_count, "Truncated checks");
  validateChecks(checks.check_runs, pr.head.sha);
  const ready = await graphql(
    `query($owner:String!,$name:String!,$number:Int!) { repository(owner:$owner,name:$name) {
    pullRequest(number:$number) { id headRefOid baseRefOid mergeStateStatus autoMergeRequest { enabledBy { login } } }
  } }`,
    { owner, name, number },
  );
  const current = ready.repository.pullRequest;
  assert.equal(current.headRefOid, pr.head.sha, "Head changed during evaluation");
  assert.equal(current.baseRefOid, mainSha, "Base changed during evaluation");
  assert.equal(current.mergeStateStatus, "CLEAN", "Do not leave deferred merge authorization");
  assert.equal(current.autoMergeRequest, null, "Existing auto-merge needs human review");
  assert.equal(await protection(), mainSha, "Main changed during evaluation");
  if (process.env.DEPENDENCY_SECURITY_AUTOMERGE !== "true") {
    console.log(
      `Dry run: PR #${number} qualifies (${update.name} ${update.oldVersion} -> ${update.newVersion}); total switch is not true.`,
    );
    return;
  }
  mutationStarted = true;
  const errors = [];
  try {
    await graphql(
      `mutation($id:ID!,$head:GitObjectID!) { enablePullRequestAutoMerge(input:{pullRequestId:$id,expectedHeadOid:$head,mergeMethod:SQUASH}) { pullRequest { number } } }`,
      { id: current.id, head: pr.head.sha },
    );
  } catch (error) {
    errors.push(error);
  }
  let latest;
  try {
    latest = await api(`${root}/pulls/${number}`);
    for (let attempt = 0; !latest.merged && attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      latest = await api(`${root}/pulls/${number}`);
    }
  } catch (error) {
    errors.push(error);
  }
  // An unknown GET result is not proof of completion: always attempt revocation
  // unless GitHub has positively reported the PR merged.
  if (!latest?.merged) {
    try {
      await disable(current.id);
    } catch (error) {
      errors.push(error);
    }
    try {
      latest = await api(`${root}/pulls/${number}`);
    } catch (error) {
      errors.push(error);
    }
  }
  if (latest?.merged) {
    try {
      await dispatch(latest);
    } catch (error) {
      errors.push(error);
    }
  } else {
    errors.push(new Error(`PR #${number} did not merge immediately; inspect auto-merge state`));
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, `PR #${number}: merge or continuation failed`);
}

// Recovery never grants merge authority: an authorized workflow_dispatch may
// re-run CI for an already-merged, same-repository bot PR at current main.
// It intentionally works with the merge switch off so operators can recover.
if (process.env.RECOVER_PR) {
  assert.match(process.env.RECOVER_PR, /^[1-9]\d*$/);
  const pr = await api(`${root}/pulls/${process.env.RECOVER_PR}`);
  assert.equal(pr.user?.id, 49699333);
  assert.equal(pr.base?.ref, "main");
  assert.equal(pr.head?.repo?.full_name, repository);
  await dispatch(pr);
} else {
  // Reconcile our stranded grants before policy/alert probes, including when
  // the merge switch is off. Human/App grants are never taken over.
  const pending = await allOpenPulls();
  for (const pr of pending.filter((pull) => pull.user?.id === 49699333)) {
    const state = await mergeAuthorization(pr.number);
    if (state.autoMergeRequest?.enabledBy?.login === "github-actions[bot]") {
      const errors = [];
      try {
        await disable(state.id);
      } catch (error) {
        errors.push(error);
      }
      try {
        const latest = await api(`${root}/pulls/${pr.number}`);
        if (latest.merged) await dispatch(latest);
        else
          assert.equal(
            (await mergeAuthorization(pr.number)).autoMergeRequest,
            null,
            "Stranded authorization was not revoked",
          );
      } catch (error) {
        errors.push(error);
      }
      if (errors.length) throw new AggregateError(errors, `PR #${pr.number}: stranded authorization cleanup failed`);
    }
  }
  const cleanupOnly = process.env.DEPENDENCY_SECURITY_AUTOMERGE !== "true" && process.env.PROBE_PERMISSIONS !== "true";
  if (cleanupOnly) {
    const status = [
      "mode=cleanup-only",
      "automerge=disabled",
      "qualification=BLOCKED",
      "Cleanup completed; this is not a passing merge qualification or permissions smoke.",
      "GITHUB_TOKEN cannot read the required branch protection: Administration: read is unavailable in workflow permissions.",
      "Observed failure: https://github.com/The-poem-of-destiny/workshop/actions/runs/40467982092",
      "Manual probe_permissions=true retains the real failing permissions probe; no alternate credential is configured.",
    ].join("\n");
    console.log(status);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${status}\n`);
  } else {
    // Probe actual workflow-token visibility even with no bot PRs or alerts.
    await protection();
    await alerts();
    console.log("Workflow token can inspect strict main protection and complete vulnerability alert data.");
    const pulls = await list(`${root}/pulls?state=open&base=main`);
    for (const pr of pulls.filter((pull) => pull.user?.id === 49699333)) {
      try {
        await evaluate(pr.number);
      } catch (error) {
        if (mutationStarted) throw error;
        // Refusal is expected for ordinary weekly updates. API/permission/schema
        // failures also remain manual; never downgrade the security predicate.
        console.log(`Manual review required for PR #${pr.number}: ${error.message}`);
      }
    }
  }
}

const token = process.env.GH_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
const [owner, name] = repository.split("/");
async function request(label, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  console.log(JSON.stringify({ label, status: response.status, data }));
}
for (const suffix of [
  "branches/main",
  "branches/main/protection",
  "rules/branches/main",
  "dependabot/alerts?per_page=1",
])
  await request(suffix, `/repos/${repository}/${suffix}`);
for (const [label, selection] of Object.entries({
  base: 'autoMergeAllowed viewerPermission ref(qualifiedName:"refs/heads/main"){target{oid}}',
  refUpdate:
    'ref(qualifiedName:"refs/heads/main"){refUpdateRule{allowsDeletions allowsForcePushes requiredStatusCheckContexts requiredApprovingReviewCount viewerCanPush}}',
  ruleId: 'ref(qualifiedName:"refs/heads/main"){branchProtectionRule{id}}',
  ruleBasic:
    'ref(qualifiedName:"refs/heads/main"){branchProtectionRule{requiresStatusChecks requiresStrictStatusChecks isAdminEnforced allowsForcePushes allowsDeletions}}',
  checks: 'ref(qualifiedName:"refs/heads/main"){branchProtectionRule{requiredStatusChecks{context app{databaseId}}}}',
  bypass:
    'ref(qualifiedName:"refs/heads/main"){branchProtectionRule{bypassPullRequestAllowances(first:1){totalCount}}}',
  alerts:
    "vulnerabilityAlerts(first:1){pageInfo{hasNextPage} nodes{state vulnerableManifestPath dependabotUpdate{pullRequest{number headRefOid}}}}",
  prViewer:
    "pullRequest(number:45){mergeStateStatus viewerCanMergeAsAdmin viewerCanEnableAutoMerge headRefOid baseRefOid}",
}))
  await request(label, "/graphql", {
    query: `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${selection}}}`,
    variables: { owner, name },
  });

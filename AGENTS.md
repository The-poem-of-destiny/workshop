# Repository Operating Rules

These rules apply to all agents and automated sessions working in this repository.

## Canonical Git topology

- User fork / development repository: `https://github.com/uikawinwing/myrepo.git`
- Owner / canonical repository: `https://github.com/AkabaneSaki/myrepo.git`
- Preferred remote names:
  - `origin` = user fork (`uikawinwing/myrepo`)
  - `upstream` = owner repository (`AkabaneSaki/myrepo`)
- `upstream/main` is the canonical production source branch.
- `origin/main` should be kept synchronized with `upstream/main`; do not use the fork `main` as a task-development branch.

Before the first Git remote operation in every session, verify both actual remote URLs. Never infer ownership from a remote name alone.

## Infrastructure boundary

Git hosting and runtime infrastructure are separate concerns.

- The user fork is a code-development/fork repository only. It does **not** imply ownership or use of the owner's Discord bot/OAuth configuration, Cloudflare Worker, D1, KV, R2, secrets, or production bindings.
- Production Discord and Cloudflare configuration belongs to the production/owner environment and must be verified separately before any deploy or permission change.
- Do not copy, infer, or substitute production credentials/bindings from the user fork.
- A branch being pushed to `origin` does not deploy or reconfigure production.

## Required Git preflight

Before commit, merge, rebase, push, tag, PR preparation, deploy, or branch cleanup:

1. Check the current branch and dirty state.
2. Verify `origin` points to `uikawinwing/myrepo`.
3. Verify `upstream` points to `AkabaneSaki/myrepo`.
4. Refresh owner main explicitly with:
   `git fetch upstream main:refs/remotes/upstream/main`
   Do not rely on `FETCH_HEAD` as proof that `upstream/main` is current.
5. Compare the task branch against refreshed `upstream/main`.
6. Never use `git add .` in a dirty multi-task workspace. Stage explicit reviewed paths only.
7. Never force-push `upstream/main` or `origin/main`.

## Normal task / production hotfix flow

1. Refresh `upstream/main`.
2. Synchronize `origin/main` with `upstream/main` when needed.
3. Create a short-lived task branch from refreshed `upstream/main`.
4. Implement, test, and review.
5. Commit only the intended files.
6. Push the task branch to `origin` (the user fork).
7. Open/prepare a PR from `uikawinwing:<task-branch>` to `AkabaneSaki:main`.
8. Merge through the owner repository when approved.
9. For production changes, deploy the exact owner-main commit after merge under the verified production Cloudflare/Discord environment.
10. Re-sync the fork `main` and delete the temporary task branch locally and remotely.

Do not push task branches directly to the owner repository as the normal workflow. Do not deploy a dirty working tree unless the user explicitly requests an emergency exception. Any emergency exception must be reconciled back through the fork/PR flow before the task is considered complete.

## Branch lifecycle

Keep long-lived branches to a minimum:

- `upstream/main`: canonical owner / production source branch.
- `origin/main`: synchronized mirror of `upstream/main`, not a development branch.
- `staging`: optional long-lived branch only if it is actively used for a real staging environment.
- `fix/*`, `hotfix-*`, `release-*`, `cw-test-*`, `recovery-*`: temporary task branches on the user fork. Merge through PR or intentionally abandon them, then delete them.

Before deleting a temporary branch, confirm one of:

- its required changes are already contained in refreshed `upstream/main`, or
- its unique commits are intentionally obsolete, or
- its required commits have been cherry-picked/recreated elsewhere.

If a branch conflicts with current `upstream/main`, do not merge it wholesale just to clean up. Inspect its unique commits and cherry-pick only still-needed work.

## Merge safety

For uncertain old branches, test from refreshed `upstream/main` with a temporary audit branch and `git merge --no-commit --no-ff <branch-or-sha>`. Abort after the test. Do not test merges inside a dirty user working tree without first preserving and later restoring those changes.

## Deployment/account safety

For Cloudflare production deploys, use the configured production profile and verify the target account/resources before deployment. Production deployment success does not mean GitHub has been updated; always record and reconcile the Git commit separately.

## Session closeout

Before declaring a task finished, report:

- current branch
- commit SHA(s) created
- where each commit was pushed
- whether owner `main` contains the change
- production deployment status, if applicable
- temporary branches that remain and why
- unrelated local changes intentionally left untouched

See `docs/GIT-WORKFLOW.md` for the full human-readable SOP.

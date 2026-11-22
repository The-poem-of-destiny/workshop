"""Decide whether an exact, successful main CI revision needs a staging release."""

import json
import os
import re
import subprocess
import sys

SHA = r"[0-9a-f]{40}"
RELEASE_INPUTS = (
    "apps/worker/",
    "apps/tavern-client/",
    "packages/",
    "tools/",
    "tests/",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml",
    "package.json",
    ".nvmrc",
    ".github/scripts/",
    ".github/workflows/deploy-staging.yml",
)


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def github_pages(path, key):
    pages = json.loads(command("gh", "api", "--paginate", "--slurp", path))
    if not pages or not isinstance(pages, list):
        raise ValueError(f"Missing GitHub history for {key}.")
    return [row for page in pages for row in page[key]]


def succeeded(job, *steps):
    return job["conclusion"] == "success" and all(
        step_conclusion(job, name) == "success" for name in steps
    )


def step_conclusion(job, name):
    matches = [step["conclusion"] for step in job["steps"] if step["name"] == name]
    return matches[0] if len(matches) == 1 else None


def accepted_application(repo):
    runs = json.loads(command(
        "gh", "run", "list", "--repo", repo, "--workflow", "deploy-staging.yml",
        "--branch", "main", "--event", "workflow_run",
        "--limit", "100", "--json", "databaseId,attempt,conclusion",
    ))
    if not isinstance(runs, list):
        raise ValueError("Invalid staging workflow history.")
    for run in runs:
        conclusion = run["conclusion"]
        if conclusion in ("failure", "cancelled", "timed_out"):
            # A deployment may have changed the live Worker or client before failing.
            # Reestablish a tested baseline even if the application diff is empty.
            return None
        if conclusion != "success":
            continue
        run_id = run["databaseId"]
        attempt = run["attempt"]
        if not isinstance(run_id, int) or not isinstance(attempt, int):
            raise ValueError("Invalid staging run identity.")
        path = f"repos/{repo}/actions/runs/{run_id}"
        jobs = github_pages(f"{path}/jobs?filter=latest&per_page=100", "jobs")
        deploys = [job for job in jobs if job["name"] == "deploy" or job["name"].startswith("deploy ")]
        if not deploys and any(job["name"] == "build" and job["conclusion"] == "skipped" for job in jobs):
            continue
        if len(deploys) != 1:
            raise ValueError(f"Missing or ambiguous deploy job in staging run {run_id}.")
        deploy = deploys[0]
        if deploy["conclusion"] == "skipped":
            continue
        if succeeded(deploy, "Confirm no staging mutation") and all(
            step_conclusion(deploy, name) == "skipped"
            for name in ("Deploy staging worker", "Publish staging client", "Smoke test")
        ):
            continue
        if deploy["run_attempt"] != attempt or not succeeded(
            deploy, "Deploy staging worker", "Publish staging client", "Smoke test"
        ):
            raise ValueError(f"No matching successful deploy and smoke in staging run {run_id}.")
        match = re.fullmatch(f"deploy ({SHA})", deploy["name"])
        if match and succeeded(deploy, "Record staging acceptance", "Upload staging acceptance evidence"):
            # A skipped run is not a new baseline. An expired artifact needs a fresh build and smoke.
            artifacts = github_pages(f"{path}/artifacts?per_page=100", "artifacts")
            required = {f"release-{match[1]}", f"staging-evidence-{match[1]}-{attempt}"}
            available = {artifact["name"] for artifact in artifacts if artifact["expired"] is False}
            return match[1] if required <= available else None
        if deploy["name"] != "deploy" or attempt != 1:
            raise ValueError(f"No unambiguous release source in staging run {run_id}.")

        # Before SHA-named deploy jobs, a first-attempt, smoke-tested run's release
        # artifact name supplies its source. Never infer it from the run's head_sha.
        builds = [job for job in jobs if job["name"] == "build" and job["run_attempt"] == 1]
        if len(builds) != 1 or not succeeded(builds[0], "Record provenance"):
            raise ValueError(f"No successful first-attempt build in staging run {run_id}.")
        artifacts = github_pages(f"{path}/artifacts?per_page=100", "artifacts")
        releases = [artifact for artifact in artifacts if artifact["name"].startswith("release-")]
        if len(releases) == 1 and releases[0]["expired"] is False:
            match = re.fullmatch(f"release-({SHA})", releases[0]["name"])
            if match:
                return match[1]
        return None
    return None


def require_ancestor(commit, head, label):
    if not re.fullmatch(SHA, commit):
        raise ValueError(f"Invalid {label} SHA.")
    if subprocess.run(["git", "merge-base", "--is-ancestor", commit, head]).returncode:
        raise ValueError(f"{label} is missing or outside the candidate's ancestry.")


def decide(repo, head, force=False):
    if not re.fullmatch(SHA, head) or command("git", "rev-parse", "HEAD") != head:
        raise ValueError("Checkout does not match the CI event SHA.")
    current = command("gh", "api", f"repos/{repo}/git/ref/heads/main", "--jq", ".object.sha")
    if not re.fullmatch(SHA, current):
        raise ValueError("Could not verify current main.")
    if current != head:
        print(f"::notice::main moved to {current}; skipping stale {head}.")
        return False

    if force:
        print("::notice::Explicit current-main staging release requested; live schema must still match.")
        return True

    base = accepted_application(repo)
    if base is None:
        print("::notice::No usable staging baseline; checking live schema and releasing current main.")
        return True
    require_ancestor(base, head, "Accepted staging application")
    print(f"Accepted staging application: {base}")
    status = subprocess.run(["git", "diff", "--quiet", "--no-renames", base, head, "--", *RELEASE_INPUTS]).returncode
    if status not in (0, 1):
        raise ValueError("Could not compare staging application inputs.")
    return status == 1


if __name__ == "__main__":
    try:
        deploy = decide(os.environ["GH_REPO"], os.environ["HEAD_SHA"], os.environ["FORCE_RELEASE"] == "true")
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            print(f"deploy={str(deploy).lower()}", file=output)
    except (KeyError, TypeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)

"""Resolve a release SHA to a successful staging deployment and its immutable artifacts."""

import json
import os
import re
import subprocess
import sys


def api(path, key=None):
    args = ["gh", "api"]
    if key is not None:
        args += ["--paginate", "--slurp"]
    data = json.loads(subprocess.check_output([*args, path], text=True))
    return data if key is None else [item for page in data for item in page[key]]


def select(repo, sha):
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Release source is not a full commit SHA.")
    base = f"repos/{repo}/actions"
    releases = api(f"{base}/artifacts?name=release-{sha}&per_page=100", "artifacts")
    for release in releases:
        if release["expired"] is not False:
            continue
        run_id = release["workflow_run"]["id"]
        path = f"{base}/runs/{run_id}"
        run = api(path)
        if (run["path"], run["event"], run["head_branch"], run["head_repository"]["full_name"], run["conclusion"]) != (
            ".github/workflows/deploy-staging.yml", "workflow_run", "main", repo, "success",
        ):
            continue
        attempt = run["run_attempt"]
        jobs = api(f"{path}/attempts/{attempt}/jobs?per_page=100", "jobs")
        deploys = [job for job in jobs if job["name"] == f"deploy {sha}" and job["conclusion"] == "success"]
        if len(deploys) != 1:
            continue
        steps = {step["name"]: step["conclusion"] for step in deploys[0]["steps"]}
        if any(steps.get(name) != "success" for name in (
            "Deploy staging worker", "Publish staging client", "Smoke test", "Record staging acceptance",
            "Upload staging acceptance evidence",
        )):
            continue
        matches = api(f"{path}/artifacts?name=staging-evidence-{sha}-{attempt}&per_page=100", "artifacts")
        if len(matches) == 1 and matches[0]["expired"] is False:
            return {"run": run_id, "attempt": attempt, "release": release["id"], "evidence": matches[0]["id"]}
    raise ValueError(f"No unexpired artifact and acceptance evidence for {sha}; release and smoke-test it in staging first.")


if __name__ == "__main__":
    try:
        result = select(os.environ["GITHUB_REPOSITORY"], sys.argv[1])
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
            for key, value in result.items():
                print(f"{key}={value}", file=output)
    except (KeyError, OSError, TypeError, ValueError, subprocess.CalledProcessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)

#!/usr/bin/env python3
"""Explicit offline preparation and separately authorized staging actions."""
import argparse
import importlib.util
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    prepare = commands.add_parser("prepare", help="transform and independently validate a local backup")
    for name in ("source", "manifest", "migrations", "preparation", "output"):
        prepare.add_argument("--" + name, type=Path, required=True)
    objects = commands.add_parser("objects", help="check locally or transfer and verify staging objects")
    objects.add_argument("mode", choices=("check", "upload", "verify"))
    objects.add_argument("--backup", type=Path, required=True)
    objects.add_argument("--preparation", type=Path, required=True)
    staging = commands.add_parser("staging", help="advance, inspect, or verify a staging candidate")
    staging.add_argument("mode", choices=("advance", "watch", "verify", "status"))
    staging.add_argument("--plan", type=Path, required=True)
    staging.add_argument("--state-dir", type=Path, required=True)
    staging.add_argument("--prior-state", type=Path, action="append", default=[])
    staging.add_argument("--max-batches", type=int, default=10)
    staging.add_argument("--confirm-staging", action="store_true")
    control = commands.add_parser("control", help="control staging admission or check public reads")
    control.add_argument("mode", choices=("status", "close", "open", "smoke"))
    control.add_argument("--token-file", type=Path, required=True,
                         help="existing owner-only maintenance token file; never a Cloudflare or legacy token")
    control.add_argument("--preparation", type=Path, help="validated private full-snapshot preparation; required for smoke")
    control.add_argument("--samples", type=int, default=3, help="representative detail/private/asset checks (1-10)")
    control.add_argument("--timeout", type=int, default=60, help="per-request timeout in seconds (1-300)")
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            run(sys.executable, str(HERE / "full-transform.py"), str(args.source), str(args.manifest), str(args.preparation))
            run("node", str(HERE / "full-r2.mjs"), "check", str(args.manifest.parent), str(args.preparation))
            run(sys.executable, str(HERE / "multiday-plan.py"), "--preparation", str(args.preparation),
                "--source", str(args.source), "--manifest", str(args.manifest), "--migrations", str(args.migrations),
                "--output", str(args.output))
        elif args.command == "objects":
            run("node", str(HERE / "full-r2.mjs"), args.mode, str(args.backup), str(args.preparation))
        elif args.command == "control":
            spec = importlib.util.spec_from_file_location("staging_control", HERE / "full-staging-control.py")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module.run(args)
        else:
            command = [sys.executable, str(HERE / "multiday-staging.py"), args.mode, "--plan", str(args.plan),
                       "--state-dir", str(args.state_dir), "--max-batches", str(args.max_batches)]
            for prior_state in args.prior_state:
                command.extend(("--prior-state", str(prior_state)))
            if args.confirm_staging:
                command.append("--confirm-staging")
            run(*command)
    except subprocess.CalledProcessError as error:
        return error.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())

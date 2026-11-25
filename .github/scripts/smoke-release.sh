#!/usr/bin/env bash
set -euo pipefail

base="${1%/}"
channel="$2"
client_dist=apps/tavern-client/dist
probe="$(mktemp -d)"
trap 'rm -r -- "$probe"' EXIT

retry_check() {
  local max_attempts=6
  local delay_seconds=5
  local attempt
  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if "$@"; then
      return 0
    fi
    if ((attempt == max_attempts)); then
      return 1
    fi
    sleep "$delay_seconds"
  done
}

check_health() {
  curl -fsS --max-time 20 "$base/api/v1/health" -o "$probe/health.json" &&
    jq -e '.ok and .bindings.db and .bindings.r2 and .bindings.assets' "$probe/health.json" >/dev/null
}

check_index() {
  curl -fsS --max-time 20 "$base/" -o "$probe/index.html" &&
    cmp "$probe/index.html" apps/worker/web/dist/index.html
}

check_client_bundle() {
  curl -fsS --max-time 20 "$base/client/$channel/index.js" -o "$probe/client.js" &&
    cmp "$probe/client.js" "$client_dist/index.js"
}

check_client_version() {
  curl -fsS --max-time 20 "$base/api/v1/client/version?channel=$channel" -o "$probe/client-version.json" &&
    jq -e --arg channel "$channel" --slurpfile build "$client_dist/manifest.json" \
      '.channel == $channel and .revision == $build[0].revision and .version == $build[0].version' \
      "$probe/client-version.json" >/dev/null
}

retry_check check_health
curl -fsS --max-time 20 "$base/api/v1/projects" -o "$probe/projects.json"
jq -e '.items | type == "array"' "$probe/projects.json" >/dev/null
retry_check check_index
retry_check check_client_bundle
retry_check check_client_version
test "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$base/api/v1/me")" = 401

#!/usr/bin/env bash
set -euo pipefail

base="${1%/}"
channel="$2"
client_dist=apps/tavern-client/dist
probe="$(mktemp -d)"
trap 'rm -r -- "$probe"' EXIT

for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 20 "$base/api/v1/health" -o "$probe/health.json" &&
    jq -e '.ok and .bindings.db and .bindings.r2 and .bindings.assets' "$probe/health.json" >/dev/null; then
    break
  fi
  if [[ "$attempt" == 5 ]]; then exit 1; fi
  sleep 5
done
curl -fsS --max-time 20 "$base/api/v1/projects" -o "$probe/projects.json"
jq -e '.items | type == "array"' "$probe/projects.json" >/dev/null
curl -fsS --max-time 20 "$base/" -o "$probe/index.html"
cmp "$probe/index.html" apps/worker/web/dist/index.html
curl -fsS --max-time 20 "$base/client/$channel/index.js" -o "$probe/client.js"
cmp "$probe/client.js" "$client_dist/index.js"
curl -fsS --max-time 20 "$base/api/v1/client/version?channel=$channel" -o "$probe/client-version.json"
jq -e --arg channel "$channel" --slurpfile build "$client_dist/manifest.json" \
  '.channel == $channel and .revision == $build[0].revision and .version == $build[0].version' \
  "$probe/client-version.json" >/dev/null
test "$(curl -sS --max-time 20 -o /dev/null -w '%{http_code}' "$base/api/v1/me")" = 401

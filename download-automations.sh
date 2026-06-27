#!/usr/bin/env bash

# Download all automations from Home Assistant and save them to automations.yml

set -euo pipefail

cd "$(dirname "$0")"

HOST="${HOME_ASSISTANT_HOST:-https://domovoy.local}"
OUTPUT="automations.yml"

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

if [ -z "${HOME_ASSISTANT_TOKEN:-}" ]; then
  echo "HOME_ASSISTANT_TOKEN is not set (expected in .env)." >&2
  exit 1
fi

api() {
  curl -fsS -m 30 \
    -H "Authorization: Bearer $HOME_ASSISTANT_TOKEN" \
    -H "Content-Type: application/json" \
    "$HOST/api/$1"
}

echo "Fetching automation list from $HOST ..."

# Each automation entity exposes its unique id in attributes.id.
ids="$(api "states" | jq -r '.[] | select(.entity_id | startswith("automation.")) | .attributes.id // empty')"

if [ -z "$ids" ]; then
  echo "No automations found (or none are UI-managed)." >&2
  exit 1
fi

# Collect every automation config into a JSON array, then convert to YAML.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

count=0
echo "[" > "$tmp"
while IFS= read -r id; do
  [ -z "$id" ] && continue
  if [ "$count" -gt 0 ]; then echo "," >> "$tmp"; fi
  api "config/automation/config/$id" >> "$tmp"
  count=$((count + 1))
  echo "  - $id" >&2
done <<< "$ids"
echo "]" >> "$tmp"

python3 -c "
import sys, json, yaml
data = json.load(open('$tmp'))
with open('$OUTPUT', 'w') as f:
    yaml.safe_dump(data, f, sort_keys=False, allow_unicode=True, default_flow_style=False)
"

echo "Saved $count automation(s) to $OUTPUT"

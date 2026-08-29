#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-issue-sync-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT

mkdir -p "$workspace/repo/scripts" "$workspace/repo/.scratch/children/issues" "$workspace/bin"
cp "$repository_root/scripts/issue-sync" "$workspace/repo/scripts/issue-sync"
cp "$repository_root/tooling/quality/fixtures/fake-gh" "$workspace/bin/gh"
chmod +x "$workspace/repo/scripts/issue-sync" "$workspace/bin/gh"
git -C "$workspace/repo" init -q

cat >"$workspace/repo/.scratch/children/PRD.md" <<'EOF'
# Historical local-only packet

This packet intentionally has no GitHub projection field.
EOF

cat >"$workspace/repo/ROADMAP.md" <<'EOF'
# Test roadmap

Status: ready-for-agent
GitHub issue: pending
Parent: none
Blocked by: none
EOF

cat >"$workspace/repo/.scratch/children/issues/01-blocker.md" <<'EOF'
# Test blocker

Status: ready-for-agent
GitHub issue: pending
Parent: ROADMAP.md
Blocked by: none
EOF

cat >"$workspace/repo/.scratch/children/issues/02-child.md" <<'EOF'
# Test child

Status: ready-for-human
GitHub issue: pending
Parent: ROADMAP.md
Blocked by: .scratch/children/issues/01-blocker.md
EOF

export GH_FAKE_DIR="$workspace/gh"
export PATH="$workspace/bin:$PATH"
cd "$workspace/repo"

./scripts/issue-sync push --all >/dev/null
[[ "$(find "$GH_FAKE_DIR/issues" -name '*.json' | wc -l | tr -d ' ')" == 3 ]]
root_url="$(awk -F': ' '/^GitHub issue:/ { print $2 }' ROADMAP.md | tr -d '<>')"
blocker_url="$(awk -F': ' '/^GitHub issue:/ { print $2 }' .scratch/children/issues/01-blocker.md | tr -d '<>')"
child_url="$(awk -F': ' '/^GitHub issue:/ { print $2 }' .scratch/children/issues/02-child.md | tr -d '<>')"
child_file="$GH_FAKE_DIR/issues/$(basename "$child_url").json"
jq -e --arg root "$root_url" --arg blocker "$blocker_url" \
  '.parent.url == $root and .blockedBy.nodes == [{url:$blocker}] and any(.labels[]; .name == "ready-for-human")' \
  "$child_file" >/dev/null
grep -Fq '<!-- promptiris-local-issue: .scratch/children/issues/02-child.md -->' "$child_file"

# Simulate interruption after remote creation but before the local URL write.
sed 's|^GitHub issue: <https://github.com/example/promptiris/issues/[0-9]*>$|GitHub issue: pending|' \
  ROADMAP.md >"$workspace/interrupted-packet"
mv "$workspace/interrupted-packet" ROADMAP.md
./scripts/issue-sync push ROADMAP.md >/dev/null
[[ "$(find "$GH_FAKE_DIR/issues" -name '*.json' | wc -l | tr -d ' ')" == 3 ]]
[[ "$(awk -F': ' '/^GitHub issue:/ { print $2 }' ROADMAP.md | tr -d '<>')" == "$root_url" ]]

./scripts/issue-sync check --all >/dev/null
./scripts/issue-sync push --all >/dev/null
[[ "$(find "$GH_FAKE_DIR/issues" -name '*.json' | wc -l | tr -d ' ')" == 3 ]]
./scripts/issue-sync status --all | grep -Fq $'.scratch/children/issues/02-child.md\tready-for-human\tOPEN'

sed 's/^Status: ready-for-agent$/Status: complete/' \
  .scratch/children/issues/01-blocker.md >"$workspace/completed-packet"
mv "$workspace/completed-packet" .scratch/children/issues/01-blocker.md
./scripts/issue-sync push .scratch/children/issues/01-blocker.md >/dev/null
jq -e '.state == "CLOSED" and (.labels | length == 0)' \
  "$GH_FAKE_DIR/issues/$(basename "$blocker_url").json" >/dev/null

replacement="$workspace/manual-edit.json"
jq '.body += "\nmanual remote edit"' "$child_file" >"$replacement"
mv "$replacement" "$child_file"
if ./scripts/issue-sync push .scratch/children/issues/02-child.md >/dev/null 2>&1; then
  echo 'issue-sync overwrote an unowned remote edit' >&2
  exit 1
fi

echo 'issue-sync tests passed'

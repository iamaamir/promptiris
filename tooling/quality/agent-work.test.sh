#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-agent-work-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT

mkdir -p "$workspace/repo/scripts" "$workspace/repo/.scratch/test/issues"
cp "$repository_root/scripts/agent-work" "$workspace/repo/scripts/agent-work"
chmod +x "$workspace/repo/scripts/agent-work"
git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.email test@example.test
git -C "$workspace/repo" config user.name test
git -C "$workspace/repo" checkout -q -b isolated-task

cat >"$workspace/repo/.scratch/test/issues/01-test.md" <<'EOF'
# Test work

Status: ready-for-agent
GitHub issue: pending
Branch: `isolated-task`
Parent: none
Blocked by: none
EOF
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -qm 'test fixture'

cd "$workspace/repo"
./scripts/agent-work claim .scratch/test/issues/01-test.md agent-a --local >/dev/null
grep -Fqx 'Status: in-progress' .scratch/test/issues/01-test.md
claim="$workspace/repo/.agent/claims/isolated-task.json"
jq -e '.agentId == "agent-a" and .stage == "generator" and .branch == "isolated-task"' "$claim" >/dev/null

if ./scripts/agent-work claim .scratch/test/issues/01-test.md agent-b --local >/dev/null 2>&1; then
  echo 'duplicate claim unexpectedly succeeded' >&2
  exit 1
fi

./scripts/agent-work stage reviewer >/dev/null
jq -e '.stage == "reviewer"' "$claim" >/dev/null
./scripts/agent-work release .scratch/test/issues/01-test.md ready-for-human --local >/dev/null
grep -Fqx 'Status: ready-for-human' .scratch/test/issues/01-test.md
[[ ! -e "$claim" ]]

echo 'agent-work tests passed'

#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-agent-work-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT

mkdir -p "$workspace/repo/scripts" "$workspace/repo/.scratch/test/issues"
cp "$repository_root/scripts/agent-work" "$repository_root/scripts/finalize-candidate.mjs" \
  "$workspace/repo/scripts/"
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
PROMPTIRIS_CLAIM_LEASE_MS=5000 ./scripts/agent-work claim .scratch/test/issues/01-test.md agent-a --local >/dev/null
grep -Fqx 'Status: in-progress' .scratch/test/issues/01-test.md
claim="$workspace/repo/.agent/claims/isolated-task.json"
jq -e '.schemaVersion == 3 and .agentId == "agent-a" and .stage == "generator" and .branch == "isolated-task" and (.claimedRevision | test("^[0-9a-f]{40}$")) and .lastStageRevision == .claimedRevision' "$claim" >/dev/null

if ./scripts/agent-work claim .scratch/test/issues/01-test.md agent-b --local >/dev/null 2>&1; then
  echo 'duplicate claim unexpectedly succeeded' >&2
  exit 1
fi

if PROMPTIRIS_CLAIM_LEASE_MS=50 ./scripts/agent-work stage reviewer >/dev/null 2>&1; then
  echo 'unfinalized candidate unexpectedly entered review' >&2
  exit 1
fi
git add .scratch/test/issues/01-test.md
git commit -qm 'record claim'
base_revision="$(git rev-parse HEAD)"
PROMPTIRIS_AGENT_ROOT="$workspace/repo/.agent" PROMPTIRIS_BASE_REVISION="$base_revision" \
  node scripts/finalize-candidate.mjs finalize .scratch/test/issues/01-test.md >/dev/null
PROMPTIRIS_CLAIM_LEASE_MS=50 PROMPTIRIS_BASE_REVISION="$base_revision" ./scripts/agent-work stage reviewer >/dev/null
jq -e '.schemaVersion == 3 and .stage == "reviewer" and (.lastStageRevision | test("^[0-9a-f]{40}$"))' "$claim" >/dev/null
sleep 0.1
PROMPTIRIS_CLAIM_LEASE_MS=50 PROMPTIRIS_BASE_REVISION="$base_revision" ./scripts/agent-work stage hardener >/dev/null 2>&1 && {
  echo 'expired claim unexpectedly accepted a stage transition' >&2
  exit 1
}
PROMPTIRIS_CLAIM_LEASE_MS=5000 ./scripts/agent-work claim .scratch/test/issues/01-test.md agent-b --local >/dev/null
jq -e '.agentId == "agent-b" and .stage == "generator"' "$claim" >/dev/null
./scripts/agent-work release .scratch/test/issues/01-test.md ready-for-human --local >/dev/null
grep -Fqx 'Status: ready-for-human' .scratch/test/issues/01-test.md
[[ ! -e "$claim" ]]

echo 'agent-work tests passed'

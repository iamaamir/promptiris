#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-candidate-finalize-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT
repo="$workspace/repo"
mkdir -p "$repo/scripts" "$repo/tooling/quality" "$repo/.scratch/test/issues/01-test.evidence" "$repo/.agent/claims"
cp "$repository_root/scripts/finalize-candidate.mjs" "$repository_root/scripts/bind-role-evidence.mjs" \
  "$repo/scripts/"
cp "$repository_root/tooling/quality/role-evidence-policy.mjs" \
  "$repository_root/tooling/quality/evidence-file.mjs" "$repo/tooling/quality/"
ln -s "$repository_root/node_modules" "$repo/node_modules"
git -C "$repo" init -q
git -C "$repo" config user.email test@example.test
git -C "$repo" config user.name test
git -C "$repo" checkout -q -b isolated-task

cat >"$repo/.scratch/test/issues/01-test.md" <<'EOF'
# Test work

Status: in-progress
GitHub issue: pending
Branch: `isolated-task`
Parent: none
Blocked by: none
EOF
printf 'first\n' >"$repo/source.txt"
git -C "$repo" add .
git -C "$repo" commit -qm 'test fixture'
head="$(git -C "$repo" rev-parse HEAD)"
active_claim_expiry="$(( $(node -e 'process.stdout.write(String(Date.now()))') + 600000 ))"
cat >"$repo/.agent/claims/isolated-task.json" <<EOF
{"taskId":".scratch/test/issues/01-test.md","branch":"isolated-task","expiresAtEpochMs":0}
EOF
cat >"$repo/.scratch/test/issues/01-test.evidence/reviewer.json" <<'EOF'
{"schemaVersion":1,"producerId":"reviewer","independent":true,"verdict":"pass","findings":[],"commentDecisions":[],"evidence":[],"residualRisks":[]}
EOF

cd "$repo"
if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/finalize-candidate.mjs finalize .scratch/test/issues/01-test.md >/dev/null 2>&1; then
  echo 'expired claim unexpectedly finalized a candidate' >&2
  exit 1
fi
jq --argjson expiresAtEpochMs "$active_claim_expiry" '.expiresAtEpochMs = $expiresAtEpochMs' \
  .agent/claims/isolated-task.json >claim.json
mv claim.json .agent/claims/isolated-task.json
PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/finalize-candidate.mjs finalize .scratch/test/issues/01-test.md >/dev/null
manifest="$repo/.agent/reports/candidates/isolated-task.json"
jq -e '.taskId == ".scratch/test/issues/01-test.md" and (.candidateRevision | test("^sha256:[0-9a-f]{64}$"))' "$manifest" >/dev/null

printf 'dirty\n' >source.txt
if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/bind-role-evidence.mjs reviewer >/dev/null 2>&1; then
  echo 'dirty candidate unexpectedly bound evidence' >&2
  exit 1
fi
printf 'first\n' >source.txt

jq '.expiresAtEpochMs = 0' .agent/claims/isolated-task.json >claim.json
mv claim.json .agent/claims/isolated-task.json
if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/bind-role-evidence.mjs reviewer >/dev/null 2>&1; then
  echo 'expired claim unexpectedly bound evidence' >&2
  exit 1
fi
jq --argjson expiresAtEpochMs "$active_claim_expiry" '.expiresAtEpochMs = $expiresAtEpochMs' \
  .agent/claims/isolated-task.json >claim.json
mv claim.json .agent/claims/isolated-task.json

if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/bind-role-evidence.mjs reviewer >/dev/null 2>&1; then
  echo 'legacy self-authored report unexpectedly bound without an attempt ledger' >&2
  exit 1
fi

git add .scratch/test/issues/01-test.evidence/reviewer.json
git commit -qm 'record unbound evidence fixture'
PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/finalize-candidate.mjs check .scratch/test/issues/01-test.md >/dev/null

printf 'second\n' >source.txt
git add source.txt
git commit -qm 'change implementation'
if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/finalize-candidate.mjs check .scratch/test/issues/01-test.md >/dev/null 2>&1; then
  echo 'stale finalization unexpectedly passed' >&2
  exit 1
fi
if PROMPTIRIS_AGENT_ROOT="$repo/.agent" PROMPTIRIS_BASE_REVISION="$head" node scripts/bind-role-evidence.mjs reviewer >/dev/null 2>&1; then
  echo 'stale report unexpectedly rebound' >&2
  exit 1
fi

echo 'candidate finalization tests passed'

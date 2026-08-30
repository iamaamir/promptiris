#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-agent-context-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT

repo="$workspace/repo"
mkdir -p "$repo/scripts" "$repo/tooling/telemetry" "$repo/tooling/quality" \
  "$repo/.scratch/test/issues" "$repo/.agent/traces" "$repo/.agent/claims" "$repo/.agent/reports"
cp "$repository_root/scripts/agent-context" "$repo/scripts/agent-context"
cp "$repository_root/scripts/telemetry-analyze.mjs" "$repo/scripts/telemetry-analyze.mjs"
cp "$repository_root/tooling/telemetry/analyze.mjs" "$repo/tooling/telemetry/analyze.mjs"
cp "$repository_root/tooling/quality/coverage-reports.mjs" "$repo/tooling/quality/coverage-reports.mjs"
cp "$repository_root/tooling/quality/mutation-report.mjs" "$repo/tooling/quality/mutation-report.mjs"
chmod +x "$repo/scripts/agent-context"

git -C "$repo" init -q
git -C "$repo" config user.email test@example.test
git -C "$repo" config user.name test
git -C "$repo" checkout -q -b isolated-task

cat >"$repo/.scratch/test/issues/01-test.md" <<'EOF'
# Context test

Status: in-progress
GitHub issue: pending
Branch: `isolated-task`
Parent: none
Blocked by: none
EOF
cat >"$repo/tooling/capabilities.json" <<'EOF'
{"capabilities":{"textual_search":{"providers":["rg"]}},"providers":{"rg":{"name":"Ripgrep","capabilities":["textual_search"]}}}
EOF
echo '.agent/' >"$repo/.gitignore"
git -C "$repo" add .
git -C "$repo" commit -qm 'test fixture'

head="$(git -C "$repo" rev-parse HEAD)"
cat >"$repo/.agent/claims/isolated-task.json" <<EOF
{"schemaVersion":3,"taskId":".scratch/test/issues/01-test.md","agentId":"agent-a","stage":"reviewer","branch":"isolated-task","worktree":"$repo","claimedRevision":"$head","lastStageRevision":"$head","claimedAt":"2026-08-30T00:00:00Z","expiresAtEpochMs":1788121157865}
EOF
cat >"$repo/.agent/traces/trace.json" <<EOF
{"schemaVersion":3,"traceId":"trace-1","runId":"run-1","taskId":"verify.unit","providerId":"test-runner","tools":["rg"],"executor":"node","startedAt":"2026-08-30T00:00:00Z","startedAtEpochMs":1,"durationMs":2,"exitCode":0,"context":{"repositoryId":"repo","worktreeId":"worktree-1","branch":"isolated-task","candidateRevision":"$head","workspaceDigest":"sha256:$(printf 'a%.0s' {1..64})","dirty":false,"agentId":"agent-a"},"output":{"rawBytes":8,"modelVisibleBytes":4,"reducedBytes":4,"estimatedRawTokens":2,"estimatedModelVisibleTokens":1,"estimatedTokensAvoided":1},"evidence":{"ref":".agent/logs/trace.log","sha256":"$(printf 'b%.0s' {1..64})","redaction":{"mode":"default","count":0}}}
EOF
echo '{"runId":"run-1","profile":"candidate","status":"passed","startedAt":"2026-08-30T00:00:00Z","endedAt":"2026-08-30T00:00:01Z","failedGateCount":0}' >"$repo/.agent/reports/verification-runs.jsonl"

output="$(cd "$repo" && ./scripts/agent-context)"
[[ ! -e "$repo/.agent/reports/telemetry-summary.json" ]]
grep -Fqx 'tree: clean' <<<"$output"
grep -Fq "\"currentHead\": \"$head\"" <<<"$output"
grep -Fq '"claimedRevision"' <<<"$output"
grep -Fq '"observedWorktrees": 1' <<<"$output"
grep -Fq '"observedAgents": 1' <<<"$output"
grep -Fq '"unattributed": 0' <<<"$output"
grep -Fq '"count": 1' <<<"$output"
grep -Fq '"validatesCurrentHead": true' <<<"$output"
grep -Fq 'compare:' <<<"$output"

echo 'agent-context tests passed'

#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-tool-trace-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/repo/scripts"
cp "$repository_root/scripts/tool-trace" "$repository_root/scripts/redact-tool-output.mjs" \
  "$workspace/repo/scripts/"
git -C "$workspace/repo" init -q
git -C "$workspace/repo" config user.email test@example.test
git -C "$workspace/repo" config user.name test
git -C "$workspace/repo" checkout -q -b trace-test
printf 'fixture\n' >"$workspace/repo/input.txt"
git -C "$workspace/repo" add .
git -C "$workspace/repo" commit -qm 'test fixture'

cd "$workspace/repo"
if GITHUB_HEAD_REF=ci-trace-test \
  ./scripts/tool-trace --task redaction --provider node --tools node -- \
  node -e "console.error('Authorization: Bearer test-secret-value'); process.exit(7)" \
  >/dev/null 2>&1; then
  echo 'failing traced command unexpectedly succeeded' >&2
  exit 1
fi
trace="$(find .agent/traces -type f -name '*.json' -print -quit)"
evidence="$(jq -r .evidence.ref "$trace")"
jq -e '
  .schemaVersion == 3 and
  .exitCode == 7 and
  .context.branch == "ci-trace-test" and
  .evidence.redaction.mode == "default" and
  .evidence.redaction.count > 0
' "$trace" >/dev/null
if grep -Fq 'test-secret-value' "$evidence"; then
  echo 'secret remained in durable evidence' >&2
  exit 1
fi
grep -Fq '[REDACTED]' "$evidence"

echo 'tool-trace tests passed'

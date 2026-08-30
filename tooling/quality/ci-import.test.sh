#!/usr/bin/env bash
set -euo pipefail

repository_root="$(git rev-parse --show-toplevel)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/promptiris-ci-import-test.XXXXXX")"
trap 'rm -rf "$workspace"' EXIT
mkdir -p "$workspace/repo/scripts" "$workspace/source"
cp "$repository_root/scripts/import-ci-evidence" "$workspace/repo/scripts/import-ci-evidence"
chmod +x "$workspace/repo/scripts/import-ci-evidence"
git -C "$workspace/repo" init -q

cat >"$workspace/source/trace.json" <<'EOF'
{"schemaVersion":2,"traceId":"ci-trace"}
EOF
cat >"$workspace/source/report.json" <<'EOF'
{"schemaVersion":1,"kind":"not-a-trace"}
EOF

cd "$workspace/repo"
./scripts/import-ci-evidence "$workspace/source" run-42 >/dev/null
destination="$workspace/repo/.agent/imports/run-42/traces"
[[ -f "$destination/0-trace.json" ]]
[[ ! -f "$destination/report.json" ]]
if ./scripts/import-ci-evidence "$workspace/source" run-42 >/dev/null 2>&1; then
  echo 'duplicate CI import unexpectedly succeeded' >&2
  exit 1
fi

mkdir -p "$workspace/invalid"
printf 'not json\n' >"$workspace/invalid/broken.json"
if ./scripts/import-ci-evidence "$workspace/invalid" invalid >/dev/null 2>&1; then
  echo 'invalid CI evidence unexpectedly succeeded' >&2
  exit 1
fi
[[ ! -e "$workspace/repo/.agent/imports/invalid" ]]

echo 'CI import tests passed'

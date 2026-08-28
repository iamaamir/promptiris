#!/usr/bin/env bash
set -euo pipefail

target_root="${1:-.}"
repo_root="$(git -C "$target_root" rev-parse --show-toplevel 2>/dev/null)" || {
  echo "repository-snapshot: target is not inside a Git repository" >&2
  exit 2
}

head_revision="$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || true)"
if [[ -z "$head_revision" ]]; then
  head_revision="unborn"
fi

echo "## REPOSITORY"
printf 'root: %s\n' "$repo_root"
printf 'head: %s\n' "$head_revision"

echo
echo "## WORKTREE"
status_output="$(git -C "$repo_root" status --short)"
if [[ -n "$status_output" ]]; then
  printf '%s\n' "$status_output" | sed -n '1,60p'
else
  echo "clean"
fi

echo
echo "## RECENT COMMITS"
git -C "$repo_root" log --oneline -5 2>/dev/null || echo "none"

echo
echo "## REPOSITORY MEMORY"
memory_candidates=(
  "AGENTS.md"
  "CLAUDE.md"
  "CONTEXT.md"
  "docs/decisions.md"
  "docs/adr"
  "docs/architecture"
  ".agent"
  ".github/workflows"
)
for candidate in "${memory_candidates[@]}"; do
  if [[ -e "$repo_root/$candidate" ]]; then
    printf 'present: %s\n' "$candidate"
  else
    printf 'absent: %s\n' "$candidate"
  fi
done

echo
echo "## CONTROL ENTRYPOINTS"
control_candidates=(
  "scripts/agent-context"
  "scripts/verify-candidate"
  "scripts/tool-trace"
  "Makefile"
  "justfile"
  "Taskfile.yml"
  "package.json"
  "pyproject.toml"
  "go.mod"
  "Cargo.toml"
)
for candidate in "${control_candidates[@]}"; do
  if [[ -e "$repo_root/$candidate" ]]; then
    printf 'present: %s\n' "$candidate"
  fi
done

echo
echo "## TRACKED FILE TYPES"
git -C "$repo_root" ls-files | awk '
  function extension(path, base, parts, count) {
    count = split(path, parts, "/");
    base = parts[count];
    if (base !~ /\./ || base ~ /^\.[^.]+$/) return "[none]";
    sub(/^.*\./, ".", base);
    return tolower(base);
  }
  { counts[extension($0)] += 1 }
  END { for (item in counts) printf "%7d %s\n", counts[item], item }
' | sort -nr | sed -n '1,20p'

echo
echo "## TOP-LEVEL TRACKED PATHS"
git -C "$repo_root" ls-files | awk -F/ '{ print $1 }' | sort -u | sed -n '1,80p'

echo
echo "## MEASUREMENT BOUNDARY"
echo "read-only snapshot; file presence is not proof that a capability executes successfully"

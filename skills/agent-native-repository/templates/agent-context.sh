#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "agent-context: not inside a Git repository" >&2
  exit 2
}

echo "## REPOSITORY"
printf 'root: %s\n' "$repo_root"
printf 'head: %s\n' "$(git -C "$repo_root" rev-parse --short HEAD)"

echo
echo "## STATUS"
git -C "$repo_root" status --short | sed -n '1,40p'

echo
echo "## RECENT COMMITS"
git -C "$repo_root" log --oneline -5

echo
echo "## CHANGE SUMMARY"
git -C "$repo_root" diff --stat | sed -n '1,40p'

echo
echo "## ACTIVE WORK"
if [[ -n "${AGENT_WORK_ITEM:-}" && -f "$repo_root/.agent/work/$AGENT_WORK_ITEM/state.json" ]]; then
  sed -n '1,120p' "$repo_root/.agent/work/$AGENT_WORK_ITEM/state.json"
else
  echo "none selected; set AGENT_WORK_ITEM to a task-scoped state directory"
fi

echo
echo "## NEXT"
echo "Follow repository references; expand context only when the current task requires it."

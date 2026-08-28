#!/usr/bin/env bash
set -euo pipefail

skill_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

required_files=(
  "README.md"
  "EXAMPLES.md"
  "SKILL.md"
  "references/principles.md"
  "references/maturity-model.md"
  "references/adoption-workflows.md"
  "references/reorientation.md"
  "references/quality-gauntlet.md"
  "references/tool-routing-and-automation.md"
  "references/portability-and-extraction.md"
  "references/the-repository-is-the-runtime.md"
  "templates/AGENTS.fragment.md"
  "templates/work-item.md"
  "templates/task-state.json"
  "templates/agent-context.sh"
  "scripts/repository-snapshot.sh"
)

for relative_path in "${required_files[@]}"; do
  if [[ ! -f "$skill_root/$relative_path" ]]; then
    printf 'missing required file: %s\n' "$relative_path" >&2
    exit 1
  fi
done

skill_lines="$(wc -l < "$skill_root/SKILL.md" | tr -d ' ')"
if (( skill_lines > 100 )); then
  printf 'SKILL.md exceeds 100 lines: %s\n' "$skill_lines" >&2
  exit 1
fi

grep -q '^name: agent-native-repository$' "$skill_root/SKILL.md"
grep -q '^description: .*Use when ' "$skill_root/SKILL.md"

bash -n "$skill_root/scripts/repository-snapshot.sh"
bash -n "$skill_root/scripts/validate-skill.sh"
bash -n "$skill_root/templates/agent-context.sh"

if command -v jq >/dev/null 2>&1; then
  jq -e . "$skill_root/templates/task-state.json" >/dev/null
fi

echo "agent-native-repository skill validation passed"

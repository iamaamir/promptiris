# Portability and extraction

This skill is designed to live inside another repository during incubation and later move into an independent public repository.

## Boundaries

- `SKILL.md`, `references/`, `templates/`, and `scripts/` must remain self-contained.
- Do not import runtime code, private schemas, package aliases, or build scripts from the incubating repository.
- Use relative links inside the skill.
- Keep examples stack-neutral and label tool names as replaceable candidates.
- Keep project-specific measurements only as explicitly labeled field evidence in the long-form article.
- Do not embed credentials, private paths, generated reports, or conversation history.

## Publication checklist

- Choose a public license and add attribution for bundled material.
- Add a repository-level README with installation, supported hosts, modes, and examples.
- Add contribution, security, and release policies.
- Test the skill in at least one greenfield and two materially different brownfield repositories.
- Verify audit mode is read-only and adoption never overwrites existing authority.
- Test on supported platforms or clearly declare limitations.
- Version templates and deterministic script output contracts.
- Add fixtures for dirty trees, missing Git, monorepos, multiple instruction files, existing CI, and conflicting sources of truth.
- Publish the article as documentation, not as always-loaded skill context.
- Record changes and lessons through reviewed releases; avoid time-sensitive tool claims in core instructions.

## Extraction method

Because the directory is self-contained, it can be copied, subtree-split, or filtered into a new repository without carrying the incubating product. Preserve Git attribution where practical.

After extraction, keep one canonical upstream. Downstream copies should consume versioned releases rather than diverging silently.

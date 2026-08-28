---
status: accepted
---

# Separate the Prompt Iris public identity from private implementation names

The product, ecosystem, and externally observable contracts use **Prompt Iris**. Public npm packages use the `@promptiris/*` scope, the CLI is `promptiris`, and project-owned configuration names, environment variables, schema IDs, Recipe and Artifact IDs, runtime names, Events, Diagnostics, documentation, and other wire-visible identifiers use the `promptiris` namespace. Canonical schemas use stable `urn:promptiris:schema:*` identifiers and remain bundled; runtimes never resolve them over the network.

Private implementation names do not need a cosmetic migration. The private root workspace, repository harness identifiers, cache and temporary-file prefixes, test-only fixtures, and other values that cannot be observed by users or Plugins may retain `meta-prompt`. All npm package names, including private workspace applications, use the `@promptiris/*` scope. The generic term _meta-prompt_ may also remain when it names the technique rather than this product.

The previously considered npm scope belongs to another project, so Prompt Iris will not publish compatibility aliases under it. The public identity is reserved by the `promptiris` npm package, the `@promptiris` npm organization, and the `iamaamir/promptiris` GitHub repository.

## Consequences

Plugin authors and Hosts see one coherent Prompt Iris namespace without forcing a risk-heavy internal refactor. Any currently private identifier that later crosses a package, process, configuration, diagnostic, telemetry, or user-interface boundary must adopt the Prompt Iris identity before release. Historical implementation evidence may retain old internal names, but normative documentation must use Prompt Iris.

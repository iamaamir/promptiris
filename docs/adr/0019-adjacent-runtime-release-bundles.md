---
status: accepted
---

# Ship the Go CLI with an adjacent private Node runtime

Standalone Prompt Iris distributions will bundle a native Go protocol client beside a pinned private Node LTS executable, the compiled canonical runtime, schemas/assets, licenses, and a hashed manifest. The Go launcher resolves that sibling runtime directly and the package manager replaces the bundle as one version.

Requiring a user-installed Node would make behavior depend on PATH and unsupported versions. Reimplementing the Kernel in Go would split semantics. Embedding Node into the Go binary or adopting Node SEA would increase build/signing complexity and currently relies on an active-development surface with platform and module-loading caveats. First-run binary downloads create offline, proxy, integrity, and install-script risks.

## Consequences

Downloads are larger, and release CI must build, sign, test, inventory, and attest each OS/architecture payload. In exchange, a given CLI release starts a known runtime without network installation or ambient discovery, while the protocol boundary remains exercised. npm needs generated platform payload packages, but all are release machinery from the same monorepo and share one version/manifest.

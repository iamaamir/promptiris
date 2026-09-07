# Independent role assurance

Independent role Evidence proves that Reviewer, Hardener, and source-blind QA were distinct executions against one frozen Candidate. A hand-authored report containing `independent: true` is not proof.

## Point-of-action workflow

1. Freeze committed implementation with `pnpm candidate:finalize -- PACKET`.
2. Inspect missing roles with `scripts/agent-role status`.
3. Prepare a role with `scripts/agent-role prepare ROLE PRODUCER_ID MODEL_CLASS PARENT_ID`.
4. Give the independent invocation only the returned manifest and registered prompt.
5. If the Host cannot provide required isolation, run `scripts/agent-role unsupported ROLE REASON`. The Candidate becomes `needs-independent-roles`; a self-authored substitute cannot pass.
6. The Host writes a native proof and normalized attestation envelope. Register it with `scripts/agent-role external ROLE ENVELOPE`.
7. The role writes only its unbound report. Run `pnpm candidate:bind-role ROLE`; the binder injects Candidate, attempt, manifest, prompt, and attestation identity.
8. Commit the accepted evidence directory and run `pnpm quality:roles`.

Every command failure prints a stable code, an Evidence reference, and an exact next action. `scripts/agent-context` embeds compact role status so a replacement agent does not reconstruct it from conversation history.

## State and trust

Volatile artifacts live under shared `.agent/role-attempts/` state. The accepted append-only ledger, manifests, attestations, native proofs, and reports live under the Work Item evidence directory and are committed. Each attempt may transition only `reserved -> running -> completed|failed|invalidated`; a completed attempt may become `superseded` or `invalidated`. A changed Candidate selects a new content-addressed ledger, making old attempts non-authoritative.

The portable verifier checks prompt bytes, contiguous transitions, distinct identities, Candidate and manifest bindings, issuer/verifier registration, validity windows, nonce reuse, proof and report digests, Hardener surface completeness, and QA isolation declarations. Host attestations describe what their Host enforced; the repository does not claim to cryptographically prove another Host's internals.

QA receives a read-only bundle of public documentation, schemas, and API reports. Source, Git metadata, and symlinks are excluded. Network, environment, and ambient-filesystem isolation remain explicit capabilities: unavailable enforcement stays visible rather than becoming false passing Evidence.

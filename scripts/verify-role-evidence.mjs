#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  ROLE_NAMES,
  authoritativeAttempts,
  canonicalJson,
  deriveAttackSurfaces,
  digestBytes,
  digestJson,
  validateAttestation,
  validateBundleDirectory,
  validateEvidenceReference,
  validateRoleIdentities,
  withoutKey,
} from '../tooling/quality/role-evidence-policy.mjs';
import { readRegularEvidenceFile } from '../tooling/quality/evidence-file.mjs';

const root = resolve('.');
const git = (arguments_, options = {}) =>
  execFileSync('git', arguments_, { cwd: root, ...options });
const branch =
  process.env.PROMPTIRIS_BRANCH ??
  process.env.GITHUB_HEAD_REF ??
  git(['branch', '--show-current'], { encoding: 'utf8' }).trim();

if (branch === 'main') {
  process.stdout.write('Role evidence is not required on the integration branch.\n');
  process.exit(0);
}

const baseName =
  process.env.PROMPTIRIS_BASE_REVISION ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
const baseRevision = git(['merge-base', 'HEAD', baseName], { encoding: 'utf8' }).trim();
const trustedMode = process.env.PROMPTIRIS_TRUSTED_MODE === 'true';
const failures = [];

const reject = (code, message, evidenceRef, nextCommand) => {
  failures.push({ code, message, evidenceRef, nextCommand });
};

const collectPackets = async (directory, packets) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && !entry.name.endsWith('.evidence')) {
      await collectPackets(path, packets);
    } else if (entry.isFile() && entry.name.endsWith('.md')) packets.push(path);
  }
};

const findPacket = async () => {
  const packets = [];
  if (trustedMode) {
    packets.push(
      ...git(['ls-tree', '-r', '--name-only', baseRevision, '.scratch'], { encoding: 'utf8' })
        .trim()
        .split('\n')
        .filter((path) => path.endsWith('.md')),
    );
  } else await collectPackets('.scratch', packets);
  const matches = [];
  for (const path of packets.sort()) {
    const source = trustedMode
      ? git(['show', `${baseRevision}:${path}`], { encoding: 'utf8' })
      : await readFile(path, 'utf8');
    if (source.split('\n').includes(`Branch: \`${branch}\``)) matches.push(path);
  }
  if (matches.length !== 1) {
    throw new Error(
      `branch must have exactly one authoritative Work Item: ${branch}; found ${matches.length}`,
    );
  }
  if (trustedMode) {
    const candidateSource = await readFile(matches[0], 'utf8');
    if (!candidateSource.split('\n').includes(`Branch: \`${branch}\``)) {
      throw new Error(`candidate removed or rebound the authoritative Work Item: ${matches[0]}`);
    }
  }
  return matches[0];
};

const packet = await findPacket();
const evidenceDirectory = resolve(dirname(packet), `${basename(packet, '.md')}.evidence`);
const evidenceRelative = relative(root, evidenceDirectory);
const candidatePathspec = ['.', `:(exclude)${evidenceRelative}/**`, ':(exclude).agent/**'];

const dirty = git(['diff', '--name-only', 'HEAD', '--', ...candidatePathspec], {
  encoding: 'utf8',
}).trim();
if (dirty) {
  reject(
    'ROLE_CANDIDATE_DIRTY',
    `candidate has uncommitted source: ${dirty.split('\n').join(', ')}`,
    '.git',
    'commit the implementation, then finalize the Candidate',
  );
}
const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...candidatePathspec], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter(Boolean);
if (untracked.length > 0) {
  reject(
    'ROLE_CANDIDATE_UNTRACKED',
    `candidate has untracked source: ${untracked.join(', ')}`,
    '.git',
    'commit or remove the listed files, then finalize the Candidate',
  );
}

const candidateBytes = git([
  'diff',
  '--raw',
  '--abbrev=40',
  '-z',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  baseRevision,
  'HEAD',
  '--',
  ...candidatePathspec,
]);
const candidateRevision = `sha256:${createHash('sha256').update(candidateBytes).digest('hex')}`;

const ajv = new Ajv2020({ strict: true, allErrors: true });
const loadSchema = async (name) =>
  JSON.parse(
    await readFile(new URL(`../spec/schemas/${name}.schema.json`, import.meta.url), 'utf8'),
  );
ajv.addSchema(await loadSchema('role-attempt'));
const validators = {
  ledger: ajv.compile(await loadSchema('role-ledger')),
  manifest: ajv.compile(await loadSchema('role-input-manifest')),
  attestation: ajv.compile(await loadSchema('role-attestation-envelope')),
  reviewer: ajv.compile(await loadSchema('reviewer-report')),
  stage: ajv.compile(await loadSchema('quality-stage-report')),
};
const registry = JSON.parse(await readFile('tooling/roles/registry.json', 'utf8'));

const safeEvidenceBytes = async (reference) => {
  if (isAbsolute(reference) || reference.split('/').includes('..')) {
    throw new Error('reference is not repository-relative');
  }
  const path = resolve(root, reference);
  if (!path.startsWith(`${root}/`)) throw new Error('reference escapes repository');
  git(['ls-files', '--error-unmatch', '--', reference], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return readRegularEvidenceFile(path);
};

const loadEvidence = async (role, kind, reference) => {
  try {
    return await safeEvidenceBytes(reference);
  } catch {
    reject(
      'ROLE_EVIDENCE_MISSING',
      `${role} ${kind} is missing, untracked, unsafe, or unreadable`,
      reference,
      `restore the original ${kind} or rerun the ${role} role`,
    );
    return null;
  }
};

const validateByteDigest = (role, kind, reference, bytes, expected) => {
  if (digestBytes(bytes) === expected) return;
  reject(
    'ROLE_EVIDENCE_DIGEST_MISMATCH',
    `${role} ${kind} digest mismatch`,
    reference,
    `rerun the ${role} role against the frozen Candidate`,
  );
};

const verifyGateEvidence = async (role, attempt, records, expectedHeadRevision) => {
  if (!Array.isArray(records) || records.length === 0) {
    reject(
      'ROLE_GATE_EVIDENCE_MISSING',
      `${role} received no frozen deterministic gate Evidence`,
      attempt.inputManifestRef,
      `rerun clean deterministic gates, then prepare ${role}`,
    );
    return;
  }
  const expectedPrefix = `${evidenceRelative}/role-protocol/${attempt.attemptId}/inputs/gate-evidence/`;
  for (const record of records) {
    if (
      !record.traceRef.startsWith(expectedPrefix) ||
      !record.evidenceRef.startsWith(expectedPrefix)
    ) {
      reject(
        'ROLE_GATE_EVIDENCE_LOCATION_INVALID',
        `${role} gate Evidence is outside its attempt-scoped input directory`,
        record.traceRef,
        `rerun ${role}`,
      );
      continue;
    }
    const traceBytes = await loadEvidence(role, 'gate trace', record.traceRef);
    const logBytes = await loadEvidence(role, 'gate log', record.evidenceRef);
    if (!traceBytes || !logBytes) continue;
    validateByteDigest(
      role,
      'gate trace',
      record.traceRef,
      traceBytes,
      `sha256:${record.traceDigest}`,
    );
    validateByteDigest(
      role,
      'gate log',
      record.evidenceRef,
      logBytes,
      `sha256:${record.evidenceDigest}`,
    );
    let trace;
    try {
      trace = JSON.parse(traceBytes.toString('utf8'));
    } catch {
      reject(
        'ROLE_GATE_TRACE_INVALID',
        `${role} gate trace is not JSON`,
        record.traceRef,
        `rerun ${role}`,
      );
      continue;
    }
    if (
      trace.taskId !== record.taskId ||
      trace.providerId !== record.providerId ||
      trace.exitCode !== 0 ||
      trace.context?.branch !== branch ||
      trace.context?.candidateRevision !== expectedHeadRevision ||
      trace.context?.dirty !== false ||
      trace.evidence?.sha256 !== record.evidenceDigest
    ) {
      reject(
        'ROLE_GATE_TRACE_BINDING_INVALID',
        `${role} gate trace is not a clean passing trace for the frozen Candidate`,
        record.traceRef,
        `rerun clean deterministic gates, then prepare ${role}`,
      );
    }
  }
};

const ledgerRef = relative(root, join(evidenceDirectory, 'role-ledger.json'));
let ledger;
try {
  ledger = JSON.parse((await safeEvidenceBytes(ledgerRef)).toString('utf8'));
  if (!validators.ledger(ledger)) {
    reject(
      'ROLE_LEDGER_SCHEMA_INVALID',
      ajv.errorsText(validators.ledger.errors),
      ledgerRef,
      'rerun role binding to regenerate the accepted ledger',
    );
  }
} catch {
  reject(
    'ROLE_LEDGER_MISSING',
    'accepted append-only role ledger is missing',
    ledgerRef,
    'scripts/agent-role status',
  );
  ledger = {
    schemaVersion: 1,
    taskId: packet,
    branch,
    candidateRevision,
    entries: [],
    attestations: [],
    unsupported: [],
  };
}

for (const [field, expected] of Object.entries({ taskId: packet, branch, candidateRevision })) {
  if (ledger[field] !== expected) {
    reject(
      'ROLE_LEDGER_BINDING_INVALID',
      `role ledger does not bind ${field}`,
      ledgerRef,
      'invalidate stale roles and rerun scripts/agent-role status',
    );
  }
}
if (ledger.unsupported.length > 0) {
  reject(
    'ROLE_HOST_UNSUPPORTED',
    'the Host disclosed missing independent-role capabilities',
    ledgerRef,
    'supply registered Host attestations or authenticated maintainer Evidence',
  );
}

const selected = authoritativeAttempts(ledger.entries, candidateRevision);
for (const failure of selected.failures) {
  reject('ROLE_LEDGER_TRANSITION_INVALID', failure, ledgerRef, 'rerun the affected role');
}
for (const role of ROLE_NAMES) {
  if (!selected.attempts.has(role)) {
    reject(
      'ROLE_REQUIRED_ATTEMPT_MISSING',
      `${role} has no authoritative completed zero-finding attempt`,
      ledgerRef,
      `scripts/agent-role prepare ${role} <producer-id> <model-class> <parent-id> [host-attested|maintainer-attested]`,
    );
  }
}

const implementers = new Set(
  [...selected.attempts.values()].map(({ implementerId }) => implementerId),
);
if (implementers.size === 1) {
  for (const failure of validateRoleIdentities(selected.attempts, [...implementers][0])) {
    reject('ROLE_IDENTITY_INVALID', failure, ledgerRef, 'dispatch distinct role agents');
  }
} else if (selected.attempts.size > 0) {
  reject(
    'ROLE_IMPLEMENTER_IDENTITY_CONFLICT',
    'authoritative attempts disagree about the Implementer identity',
    ledgerRef,
    'invalidate the attempts and prepare all roles from the same claim',
  );
}

const diffBytes = git([
  'diff',
  '--binary',
  '--full-index',
  '--no-ext-diff',
  '--no-renames',
  baseRevision,
  'HEAD',
  '--',
  '.',
  ':(exclude).scratch/**/*.evidence/**',
]);
const changedPaths = git(
  [
    'diff',
    '--name-only',
    '--no-renames',
    baseRevision,
    'HEAD',
    '--',
    '.',
    ':(exclude).scratch/**/*.evidence/**',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .sort();
const trackedModules = git(
  ['ls-files', '*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs'],
  {
    encoding: 'utf8',
  },
)
  .trim()
  .split('\n')
  .filter(Boolean);
const moduleSources = new Map(
  await Promise.all(trackedModules.map(async (path) => [path, await readFile(path, 'utf8')])),
);
const expectedSurfaces = deriveAttackSurfaces(moduleSources, changedPaths);
const usedNonces = new Set();

const candidateHeadIsValid = (headRevision) => {
  if (!/^[0-9a-f]{40}$/.test(headRevision ?? '')) return false;
  try {
    git(['merge-base', '--is-ancestor', headRevision, 'HEAD']);
    const bytes = git([
      'diff',
      '--raw',
      '--abbrev=40',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      baseRevision,
      headRevision,
      '--',
      ...candidatePathspec,
    ]);
    return `sha256:${createHash('sha256').update(bytes).digest('hex')}` === candidateRevision;
  } catch {
    return false;
  }
};

const verifyManifestInputs = async (role, manifest, attempt) => {
  const workItem = manifest.inputs.find(({ kind }) => kind === 'work-item');
  const diff = manifest.inputs.find(({ kind }) => kind === 'candidate-diff');
  if (role !== 'qa' && workItem?.digest !== digestBytes(await readFile(packet))) {
    reject(
      'ROLE_WORK_ITEM_DRIFT',
      `${role} did not receive the current Work Item`,
      manifest.promptRef,
      `rerun ${role}`,
    );
  }
  if (role !== 'qa' && diff?.digest !== digestBytes(diffBytes)) {
    reject(
      'ROLE_DIFF_DRIFT',
      `${role} did not receive the frozen diff`,
      ledgerRef,
      `rerun ${role}`,
    );
  }
  for (const input of manifest.inputs.filter(({ kind }) => kind !== 'source-blind-bundle')) {
    for (const failure of await validateEvidenceReference(root, input.ref, input.digest)) {
      reject(
        'ROLE_INPUT_EVIDENCE_INVALID',
        `${role} ${input.kind}: ${failure}`,
        input.ref,
        `rerun ${role} against repository-relative frozen inputs`,
      );
    }
  }
  if (role === 'reviewer') {
    const reviewerContext = manifest.inputs.find(({ kind }) => kind === 'reviewer-context');
    if (
      !reviewerContext ||
      reviewerContext.context?.complete !== true ||
      canonicalJson(reviewerContext.context?.affectedSurfaces) !==
        canonicalJson(expectedSurfaces) ||
      reviewerContext.context?.candidate?.baseRevision !== baseRevision ||
      reviewerContext.context?.candidate?.candidateRevision !== candidateRevision ||
      !candidateHeadIsValid(reviewerContext.context?.candidate?.headRevision)
    ) {
      reject(
        'ROLE_REVIEWER_CONTEXT_INCOMPLETE',
        'Reviewer input omits affected context or frozen Candidate Evidence',
        manifest.promptRef,
        'scripts/agent-role prepare reviewer <producer-id> <model-class> <parent-id> [host-attested|maintainer-attested]',
      );
    }
    await verifyGateEvidence(
      role,
      attempt,
      reviewerContext?.context?.deterministicEvidence ?? [],
      reviewerContext?.context?.candidate?.headRevision,
    );
  }
  if (role === 'hardener') {
    const attack = manifest.inputs.find(({ kind }) => kind === 'attack-surfaces');
    const expectedEvidence = attack?.evidence ?? [];
    const expectedDocument = {
      schemaVersion: 1,
      complete: true,
      surfaces: expectedSurfaces,
      deterministicEvidence: expectedEvidence,
      candidate: attack?.candidate,
    };
    const expectedDigest = digestBytes(
      Buffer.from(`${JSON.stringify(expectedDocument, null, 2)}\n`),
    );
    if (
      !attack ||
      canonicalJson(attack.surfaces) !== canonicalJson(expectedSurfaces) ||
      attack.evidence.length === 0 ||
      attack.candidate?.baseRevision !== baseRevision ||
      attack.candidate?.candidateRevision !== candidateRevision ||
      !candidateHeadIsValid(attack.candidate?.headRevision) ||
      attack.digest !== expectedDigest
    ) {
      reject(
        'ROLE_ATTACK_SURFACES_INCOMPLETE',
        'Hardener input does not cover every deterministically changed surface',
        manifest.promptRef,
        'scripts/agent-role prepare hardener <producer-id> <model-class> <parent-id> [host-attested|maintainer-attested]',
      );
    }
    await verifyGateEvidence(role, attempt, expectedEvidence, attack?.candidate?.headRevision);
  }
  if (role !== 'qa') return;
  const bundle = manifest.inputs.find(({ kind }) => kind === 'source-blind-bundle')?.bundle;
  const bundleInput = manifest.inputs.find(({ kind }) => kind === 'source-blind-bundle');
  const expectedBundleRef = `${evidenceRelative}/role-protocol/${attempt.attemptId}/inputs/qa-bundle`;
  if (bundleInput?.ref !== expectedBundleRef) {
    reject(
      'ROLE_QA_BUNDLE_LOCATION_INVALID',
      'QA bundle is not inside its attempt-scoped Work Item Evidence directory',
      bundleInput?.ref ?? ledgerRef,
      'discard the bundle and rerun scripts/agent-role prepare qa',
    );
  }
  const required = ['sourceExcluded', 'gitMetadataExcluded', 'symlinksRejected', 'readOnlyFiles'];
  if (!bundle || required.some((capability) => bundle.capabilities[capability] !== true)) {
    reject(
      'ROLE_QA_ISOLATION_INCOMPLETE',
      'QA bundle does not prove minimum source-blind isolation',
      ledgerRef,
      'rerun QA through a Host that enforces the declared bundle',
    );
  }
  if (bundle?.files.some(({ path }) => /(?:^|\/)src(?:\/|$)|(?:^|\/)\.git(?:\/|$)/.test(path))) {
    reject(
      'ROLE_QA_SOURCE_LEAK',
      'QA bundle exposes source or Git metadata',
      ledgerRef,
      'discard the bundle and rerun scripts/agent-role prepare qa',
    );
  }
  if (bundleInput?.bundle && digestJson(bundle) !== bundleInput.digest) {
    reject(
      'ROLE_QA_BUNDLE_DIGEST_INVALID',
      'QA bundle descriptor digest does not match its declared contents',
      ledgerRef,
      'discard the bundle and rerun scripts/agent-role prepare qa',
    );
  }
  if (bundleInput) {
    const bundlePath = resolve(root, bundleInput.ref);
    for (const failure of await validateBundleDirectory(bundlePath, bundleInput.bundle?.files, {
      requireReadOnly: false,
    })) {
      reject(
        'ROLE_QA_BUNDLE_TREE_INVALID',
        failure,
        bundleInput.ref,
        'discard the bundle and rerun scripts/agent-role prepare qa',
      );
    }
    const tracked = git(['ls-files', '--', `${bundleInput.ref}/**`], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((path) => relative(bundleInput.ref, path))
      .sort();
    const declared = (bundleInput.bundle?.files ?? []).map(({ path }) => path).sort();
    if (canonicalJson(tracked) !== canonicalJson(declared)) {
      reject(
        'ROLE_QA_BUNDLE_UNTRACKED',
        'QA bundle files are not exactly preserved as tracked Evidence',
        bundleInput.ref,
        'commit the exact prepared QA bundle before verification',
      );
    }
  }
};

const verifyRole = async (role, attempt) => {
  const reportBytes = await loadEvidence(role, 'report', attempt.reportRef);
  const manifestBytes = await loadEvidence(role, 'input manifest', attempt.inputManifestRef);
  const attestationBytes = await loadEvidence(role, 'attestation', attempt.attestationRef);
  if (!reportBytes || !manifestBytes || !attestationBytes) return;
  validateByteDigest(role, 'report', attempt.reportRef, reportBytes, attempt.reportDigest);
  validateByteDigest(
    role,
    'attestation',
    attempt.attestationRef,
    attestationBytes,
    attempt.attestationDigest,
  );
  const report = JSON.parse(reportBytes.toString('utf8'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const attestation = JSON.parse(attestationBytes.toString('utf8'));
  const reportValidator = role === 'reviewer' ? validators.reviewer : validators.stage;
  if (!reportValidator(report)) {
    reject(
      'ROLE_REPORT_SCHEMA_INVALID',
      ajv.errorsText(reportValidator.errors),
      attempt.reportRef,
      `rerun ${role}`,
    );
  }
  if (!validators.manifest(manifest)) {
    reject(
      'ROLE_MANIFEST_SCHEMA_INVALID',
      ajv.errorsText(validators.manifest.errors),
      attempt.inputManifestRef,
      `rerun ${role}`,
    );
  }
  if (!validators.attestation(attestation)) {
    reject(
      'ROLE_ATTESTATION_SCHEMA_INVALID',
      ajv.errorsText(validators.attestation.errors),
      attempt.attestationRef,
      `rerun ${role}`,
    );
  }
  for (const evidence of report.evidence ?? []) {
    for (const failure of await validateEvidenceReference(
      root,
      evidence.evidenceRef,
      `sha256:${evidence.evidenceSha256}`,
    )) {
      reject(
        'ROLE_REPORT_EVIDENCE_INVALID',
        `${role} ${evidence.checkId}: ${failure}`,
        evidence.evidenceRef,
        `rerun ${role} and preserve repository-relative deterministic Evidence`,
      );
    }
  }
  if (
    digestJson(withoutKey(manifest, 'manifestDigest')) !== manifest.manifestDigest ||
    manifest.manifestDigest !== attempt.inputManifestDigest
  ) {
    reject(
      'ROLE_MANIFEST_DIGEST_INVALID',
      'input manifest self-digest is invalid',
      attempt.inputManifestRef,
      `rerun ${role}`,
    );
  }
  for (const [field, expected] of Object.entries({
    taskId: packet,
    baseRevision,
    candidateRevision,
    attemptId: attempt.attemptId,
    parentInvocationId: attempt.parentInvocationId,
    producerId: attempt.producerId,
    implementerId: attempt.implementerId,
    role,
    promptDigest: attempt.promptDigest,
  })) {
    if (manifest[field] !== expected) {
      reject(
        'ROLE_MANIFEST_BINDING_INVALID',
        `${role} manifest does not bind ${field}`,
        attempt.inputManifestRef,
        `rerun ${role}`,
      );
    }
  }
  for (const [field, expected] of Object.entries({
    taskId: packet,
    baseRevision,
    candidateRevision,
    producerId: attempt.producerId,
    attemptId: attempt.attemptId,
    parentInvocationId: attempt.parentInvocationId,
    promptDigest: attempt.promptDigest,
    inputManifestDigest: attempt.inputManifestDigest,
    attestationDigest: attempt.attestationDigest,
  })) {
    if (report[field] !== expected) {
      reject(
        'ROLE_REPORT_BINDING_INVALID',
        `${role} report does not bind ${field}`,
        attempt.reportRef,
        `rerun ${role}`,
      );
    }
  }
  if (role !== 'reviewer' && report.role !== role) {
    reject(
      'ROLE_REPORT_BINDING_INVALID',
      `${role} report does not bind its role`,
      attempt.reportRef,
      `rerun ${role}`,
    );
  }
  const registration = registry.roles[role];
  const promptBytes = await safeEvidenceBytes(registration.prompt);
  if (
    digestBytes(promptBytes) !== registration.promptDigest ||
    registration.promptDigest !== attempt.promptDigest
  ) {
    reject(
      'ROLE_PROMPT_DRIFT',
      `${role} prompt differs from its registered bytes`,
      registration.prompt,
      `rerun ${role}`,
    );
  }
  for (const failure of validateAttestation(attestation, attempt, registry)) {
    reject(
      'ROLE_ATTESTATION_INVALID',
      failure,
      attempt.attestationRef,
      `obtain a fresh ${role} attestation`,
    );
  }
  if (usedNonces.has(attestation.nonce)) {
    reject(
      'ROLE_NONCE_REPLAY',
      `${role} reuses an attestation nonce`,
      attempt.attestationRef,
      `obtain a fresh ${role} attestation`,
    );
  }
  usedNonces.add(attestation.nonce);
  for (const failure of await validateEvidenceReference(
    root,
    attestation.nativeProofRef,
    attestation.nativeProofDigest,
    join(evidenceRelative, 'role-protocol', attempt.attemptId),
  )) {
    reject(
      'ROLE_NATIVE_PROOF_INVALID',
      failure,
      attestation.nativeProofRef,
      `rerun the ${role} role with attempt-scoped native proof`,
    );
  }
  const proofBytes = await loadEvidence(role, 'native proof', attestation.nativeProofRef);
  if (proofBytes) {
    validateByteDigest(
      role,
      'native proof',
      attestation.nativeProofRef,
      proofBytes,
      attestation.nativeProofDigest,
    );
  }
  await verifyManifestInputs(role, manifest, attempt);
  if (role === 'hardener') {
    const coverage = report.surfaceCoverage ?? [];
    const coveredPaths = coverage.map(({ path }) => path).sort();
    const expectedPaths = expectedSurfaces.map(({ path }) => path).sort();
    const passedEvidence = new Set(
      report.evidence.filter(({ status }) => status === 'passed').map(({ checkId }) => checkId),
    );
    if (
      canonicalJson(coveredPaths) !== canonicalJson(expectedPaths) ||
      new Set(coveredPaths).size !== coveredPaths.length ||
      coverage.some(({ evidenceCheckId }) => !passedEvidence.has(evidenceCheckId))
    ) {
      reject(
        'ROLE_HARDENER_COVERAGE_INCOMPLETE',
        'Hardener report does not bind every attack surface to passing Evidence',
        attempt.reportRef,
        'challenge every manifest attack surface and rerun Hardener',
      );
    }
  }
  if (role === 'reviewer' && (report.verdict !== 'pass' || report.findings.length > 0)) {
    reject(
      'ROLE_REVIEW_UNRESOLVED',
      'Reviewer has unresolved findings',
      attempt.reportRef,
      'repair the Candidate and rerun every role',
    );
  }
  if (role !== 'reviewer' && report.status !== 'passed') {
    reject(
      'ROLE_STAGE_FAILED',
      `${role} did not pass`,
      attempt.reportRef,
      'repair the Candidate and rerun every role',
    );
  }
  if (role === 'qa' && report.sourceBlind !== true) {
    reject(
      'ROLE_QA_NOT_SOURCE_BLIND',
      'QA did not attest source-blind execution',
      attempt.reportRef,
      'rerun QA from the prepared bundle',
    );
  }
};

for (const [role, attempt] of selected.attempts) await verifyRole(role, attempt);

if (
  process.env.PROMPTIRIS_REQUIRE_EXTERNAL_REVIEW === 'true' &&
  Number(process.env.PROMPTIRIS_EXTERNAL_REVIEW_COUNT ?? 0) < 1
) {
  reject(
    'ROLE_EXTERNAL_REVIEW_MISSING',
    'candidate has no authenticated approval from a reviewer other than the PR author',
    'GitHub review identity',
    'request an external maintainer review',
  );
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`FAIL ${failure.code}: ${failure.message}\n`);
    process.stderr.write(`  Evidence: ${failure.evidenceRef}\n`);
    process.stderr.write(`  Next: ${failure.nextCommand}\n`);
  }
  process.stderr.write(`Expected candidate revision: ${candidateRevision}\n`);
  process.exit(1);
}
process.stdout.write(`Role evidence passed for ${packet} at ${candidateRevision}.\n`);

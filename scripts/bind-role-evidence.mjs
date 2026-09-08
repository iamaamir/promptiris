#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  ROLE_NAMES,
  digestBytes,
  digestJson,
  replayLedger,
  validateAttestation,
  validateBundleDirectory,
  validateEvidenceReference,
  withoutKey,
} from '../tooling/quality/role-evidence-policy.mjs';
import { readRegularEvidenceFile } from '../tooling/quality/evidence-file.mjs';

const role = process.argv[2];
if (!ROLE_NAMES.includes(role)) {
  throw new Error('usage: scripts/bind-role-evidence.mjs <reviewer|hardener|qa>');
}

const root = resolve('.');
const git = (arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim();
const branch = git(['branch', '--show-current']);
const commonGitDirectory = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const sharedRoot = commonGitDirectory.endsWith('/.git') ? commonGitDirectory.slice(0, -5) : root;
const agentRoot = process.env.PROMPTIRIS_AGENT_ROOT ?? join(sharedRoot, '.agent');
const candidatePath = join(agentRoot, 'reports', 'candidates', `${branch}.json`);
const candidate = JSON.parse(await readFile(candidatePath, 'utf8'));
const packet = candidate.taskId;

execFileSync(process.execPath, ['scripts/finalize-candidate.mjs', 'check', packet], {
  cwd: root,
  env: { ...process.env, PROMPTIRIS_AGENT_ROOT: agentRoot },
  stdio: ['ignore', 'ignore', 'inherit'],
});

const evidenceDirectory = resolve(dirname(packet), `${basename(packet, '.md')}.evidence`);
const stateDirectory = join(
  agentRoot,
  'role-attempts',
  branch,
  candidate.candidateRevision.replace('sha256:', ''),
);
const ledgerPath = join(stateDirectory, 'ledger.json');
const lockPath = join(commonGitDirectory, 'promptiris-locks', 'role-ledger.lock');

const atomicJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporaryPath, path);
};

const acquireLock = async () => {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    await mkdir(lockPath);
  } catch {
    const age = Date.now() - (await stat(lockPath)).mtimeMs;
    if (age <= 300_000) throw new Error('role ledger is locked by another writer');
    await rm(lockPath, { recursive: true });
    await mkdir(lockPath);
  }
};

const resolveReference = (reference) => {
  const base = reference.startsWith('.agent/') ? sharedRoot : root;
  const path = resolve(base, reference);
  const allowedRoot = reference.startsWith('.agent/') ? agentRoot : root;
  if (!path.startsWith(`${allowedRoot}/`)) throw new Error(`role reference escapes: ${reference}`);
  return path;
};

await acquireLock();
try {
  let ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const replay = replayLedger(ledger.entries, candidate.candidateRevision);
  if (replay.failures.length > 0) throw new Error(replay.failures.join('; '));
  const attempt = [...replay.attempts.values()]
    .filter((entry) => entry.role === role && entry.state === 'running')
    .sort((left, right) => right.sequence - left.sequence)[0];
  if (!attempt) {
    throw new Error(
      `no running ${role} attempt; run scripts/agent-role prepare ${role} <producer-id> <model-class> <parent-id> [host-attested|maintainer-attested]`,
    );
  }

  const attestationRecord = ledger.attestations
    .filter(({ attemptId }) => attemptId === attempt.attemptId)
    .at(-1);
  if (!attestationRecord) {
    throw new Error(
      `attempt has no validated attestation; run scripts/agent-role external ${role} <attestation.json>`,
    );
  }
  const attestationPath = resolveReference(attestationRecord.ref);
  const attestationBytes = await readRegularEvidenceFile(attestationPath);
  const attestation = JSON.parse(attestationBytes.toString('utf8'));
  if (digestBytes(attestationBytes) !== attestationRecord.digest) {
    throw new Error('stored attestation digest mismatch');
  }
  const registry = JSON.parse(await readFile('tooling/roles/registry.json', 'utf8'));
  const attestationFailures = validateAttestation(attestation, attempt, registry);
  attestationFailures.push(
    ...(await validateEvidenceReference(
      root,
      attestation.nativeProofRef,
      attestation.nativeProofDigest,
    )),
  );
  if (attestationFailures.length > 0) throw new Error(attestationFailures.join('; '));

  const inputManifestPath = resolveReference(attempt.inputManifestRef);
  const inputManifestBytes = await readRegularEvidenceFile(inputManifestPath);
  const inputManifest = JSON.parse(inputManifestBytes.toString('utf8'));
  if (digestJson(withoutKey(inputManifest, 'manifestDigest')) !== attempt.inputManifestDigest) {
    throw new Error('input manifest digest mismatch');
  }
  for (const [field, expected] of Object.entries({
    attemptId: attempt.attemptId,
    parentInvocationId: attempt.parentInvocationId,
    producerId: attempt.producerId,
    implementerId: attempt.implementerId,
    role,
    candidateRevision: candidate.candidateRevision,
    promptDigest: attempt.promptDigest,
  })) {
    if (inputManifest[field] !== expected) throw new Error(`input manifest does not bind ${field}`);
  }
  const qaBundle = inputManifest.inputs.find(({ kind }) => kind === 'source-blind-bundle');
  if (role === 'qa') {
    if (!qaBundle) throw new Error('QA input manifest has no source-blind bundle');
    const expectedBundleRef = relative(
      root,
      join(evidenceDirectory, 'role-protocol', attempt.attemptId, 'inputs', 'qa-bundle'),
    );
    if (qaBundle.ref !== expectedBundleRef) {
      throw new Error('QA bundle is outside its attempt-scoped Work Item Evidence directory');
    }
    const bundleFailures = await validateBundleDirectory(
      resolveReference(qaBundle.ref),
      qaBundle.bundle?.files,
    );
    if (bundleFailures.length > 0) throw new Error(bundleFailures.join('; '));
  }

  const reportPath = resolveReference(join(dirname(attempt.inputManifestRef), 'report.json'));
  const canonicalReportPath = join(evidenceDirectory, `${role}.json`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const binding = {
    taskId: packet,
    baseRevision: candidate.baseRevision,
    candidateRevision: candidate.candidateRevision,
    attemptId: attempt.attemptId,
    parentInvocationId: attempt.parentInvocationId,
    promptDigest: attempt.promptDigest,
    inputManifestDigest: attempt.inputManifestDigest,
    attestationDigest: attestationRecord.digest,
  };
  for (const [field, value] of Object.entries(binding)) {
    if (report[field] !== undefined) {
      throw new Error(`refusing to bind report-authored identity field: ${field}`);
    }
    report[field] = value;
  }
  if (report.producerId !== attempt.producerId)
    throw new Error('report producer does not match attempt');
  if (role !== 'reviewer' && report.role !== role)
    throw new Error(`report role does not match: ${role}`);

  await atomicJson(reportPath, report);
  await atomicJson(canonicalReportPath, report);

  const unresolvedFindingCount =
    role === 'reviewer'
      ? report.findings.length
      : report.status === 'passed'
        ? 0
        : Math.max(1, report.evidence.filter(({ status }) => status === 'failed').length);
  const completed = {
    ...attempt,
    sequence: ledger.entries.length + 1,
    state: 'completed',
    inputManifestRef: attempt.inputManifestRef,
    attestationRef: attestationRecord.ref,
    attestationDigest: attestationRecord.digest,
    reportRef: relative(root, reportPath),
    reportDigest: digestBytes(await readFile(reportPath)),
    unresolvedFindingCount,
    recordedAt: new Date().toISOString(),
  };
  const entries = [...ledger.entries, completed];
  const completedReplay = replayLedger(entries, candidate.candidateRevision);
  if (completedReplay.failures.length > 0) throw new Error(completedReplay.failures.join('; '));
  ledger = { ...ledger, entries };
  await atomicJson(ledgerPath, ledger);
  await atomicJson(join(evidenceDirectory, 'role-ledger.json'), ledger);
  process.stdout.write(`${canonicalReportPath}\n`);
} finally {
  await rm(lockPath, { recursive: true });
}

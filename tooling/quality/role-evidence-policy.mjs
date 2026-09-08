import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { isAbsolute, posix, relative, resolve } from 'node:path';
import ts from 'typescript';

export const ROLE_NAMES = Object.freeze(['reviewer', 'hardener', 'qa']);
const modelClasses = Object.freeze(['quick', 'general', 'frontier']);

const transitions = Object.freeze({
  reserved: Object.freeze(['running', 'failed', 'invalidated']),
  running: Object.freeze(['completed', 'failed', 'invalidated']),
  completed: Object.freeze(['superseded', 'invalidated']),
  failed: Object.freeze([]),
  invalidated: Object.freeze([]),
  superseded: Object.freeze([]),
});

const immutableAttemptFields = Object.freeze([
  'attemptId',
  'parentInvocationId',
  'implementerId',
  'producerId',
  'role',
  'promptId',
  'promptDigest',
  'modelClass',
  'candidateRevision',
  'inputManifestRef',
  'inputManifestDigest',
  'sourceAccessMode',
]);

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
};

export const canonicalJson = (value) => JSON.stringify(stableValue(value));
export const digestBytes = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
export const digestJson = (value) => digestBytes(canonicalJson(value));

export const withoutKey = (value, key) =>
  Object.fromEntries(Object.entries(value).filter(([candidate]) => candidate !== key));

export const validTransition = (from, to) => transitions[from]?.includes(to) ?? false;

const changedImmutableField = (previous, next) =>
  immutableAttemptFields.find((field) => previous[field] !== next[field]);

export function replayLedger(entries, expectedCandidateRevision) {
  const failures = [];
  const attempts = new Map();
  entries.forEach((entry, index) => {
    const expectedSequence = index + 1;
    if (entry.sequence !== expectedSequence) {
      failures.push(`entry ${index} must have sequence ${expectedSequence}`);
    }
    if (entry.candidateRevision !== expectedCandidateRevision) {
      failures.push(`attempt ${entry.attemptId} is bound to a different Candidate`);
    }
    if (!ROLE_NAMES.includes(entry.role))
      failures.push(`attempt ${entry.attemptId} has unknown role`);
    if (!modelClasses.includes(entry.modelClass)) {
      failures.push(`attempt ${entry.attemptId} has unknown model class`);
    }
    if (
      entry.state === 'completed' &&
      ['reportRef', 'reportDigest', 'attestationRef', 'attestationDigest'].some(
        (field) => !entry[field],
      )
    ) {
      failures.push(`attempt ${entry.attemptId} completed without bound Evidence`);
    }
    if (entry.state === 'completed' && entry.attestationStrength === 'unsupported') {
      failures.push(`attempt ${entry.attemptId} completed with unsupported attestation`);
    }
    const previous = attempts.get(entry.attemptId);
    if (!previous) {
      if (entry.state !== 'reserved')
        failures.push(`attempt ${entry.attemptId} must start reserved`);
    } else {
      const changed = changedImmutableField(previous, entry);
      if (changed) failures.push(`attempt ${entry.attemptId} changed immutable ${changed}`);
      if (!validTransition(previous.state, entry.state)) {
        failures.push(
          `attempt ${entry.attemptId} cannot transition ${previous.state} -> ${entry.state}`,
        );
      }
    }
    attempts.set(entry.attemptId, entry);
  });
  return { attempts, failures };
}

export function authoritativeAttempts(entries, candidateRevision) {
  const replay = replayLedger(entries, candidateRevision);
  if (replay.failures.length > 0) return { attempts: new Map(), failures: replay.failures };
  const authoritative = new Map();
  for (const role of ROLE_NAMES) {
    const attempts = [...replay.attempts.values()]
      .filter(
        (attempt) =>
          attempt.role === role &&
          attempt.state === 'completed' &&
          attempt.unresolvedFindingCount === 0,
      )
      .sort((left, right) => right.sequence - left.sequence);
    if (attempts[0]) authoritative.set(role, attempts[0]);
  }
  return { attempts: authoritative, failures: [] };
}

export function validateRoleIdentities(attempts, implementerId) {
  const failures = [];
  if (attempts.size !== ROLE_NAMES.length)
    failures.push('not every required role is authoritative');
  const producers = [...attempts.values()].map(({ producerId }) => producerId);
  if (new Set(producers).size !== producers.length) {
    failures.push('role producer identities are not distinct');
  }
  if (producers.includes(implementerId)) failures.push('the Implementer produced role Evidence');
  return failures;
}

export function validateAttestation(envelope, attempt, registry, now = Date.now()) {
  const failures = [];
  if (!registry.issuers.includes(envelope.issuer))
    failures.push('attestation issuer is not registered');
  const authorizedStrengths = registry.issuerStrengths?.[envelope.issuer];
  if (!authorizedStrengths?.includes(envelope.attestationStrength)) {
    failures.push('attestation issuer does not authorize its declared strength');
  }
  if (!registry.verifiers.includes(envelope.verifierId)) {
    failures.push('attestation verifier is not registered');
  }
  if (envelope.attestationStrength === 'unsupported') {
    failures.push('unsupported attestation cannot satisfy a required role');
  }
  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt >= expiresAt) {
    failures.push('attestation validity interval is invalid');
  } else if (expiresAt <= now) failures.push('attestation is expired');
  for (const field of [
    'attemptId',
    'parentInvocationId',
    'producerId',
    'role',
    'candidateRevision',
    'promptDigest',
    'inputManifestDigest',
    'sourceAccessMode',
    'attestationStrength',
  ]) {
    if (envelope[field] !== attempt[field]) failures.push(`attestation does not bind ${field}`);
  }
  return failures;
}

export async function validateEvidenceReference(root, reference, expectedDigest) {
  if (isAbsolute(reference) || reference.split('/').includes('..')) {
    return ['evidence reference is not repository-relative'];
  }
  const path = resolve(root, reference);
  if (relative(root, path).startsWith('..')) return ['evidence reference escapes repository'];
  try {
    return digestBytes(await readFile(path)) === expectedDigest
      ? []
      : ['evidence digest does not match'];
  } catch {
    return ['evidence reference is missing or unreadable'];
  }
}

const safeBundlePath = (path) =>
  path.length > 0 &&
  !isAbsolute(path) &&
  !path.split('/').includes('..') &&
  posix.normalize(path) === path;

const inspectBundleDirectory = async (root, directory = '') => {
  const entries = [];
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    const metadata = await lstat(resolve(root, path));
    if (metadata.isSymbolicLink()) throw new Error(`bundle contains symbolic link: ${path}`);
    if (metadata.isDirectory()) {
      if ((metadata.mode & 0o222) !== 0) throw new Error(`bundle directory is writable: ${path}`);
      entries.push(...(await inspectBundleDirectory(root, path)));
      continue;
    }
    if (!metadata.isFile()) throw new Error(`bundle contains non-regular file: ${path}`);
    if ((metadata.mode & 0o222) !== 0) throw new Error(`bundle file is writable: ${path}`);
    entries.push({ path, digest: digestBytes(await readFile(resolve(root, path))) });
  }
  return entries;
};

export async function validateBundleDirectory(root, declaredFiles) {
  if (!Array.isArray(declaredFiles) || declaredFiles.some(({ path }) => !safeBundlePath(path))) {
    return ['bundle descriptor contains an unsafe path'];
  }
  if (new Set(declaredFiles.map(({ path }) => path)).size !== declaredFiles.length) {
    return ['bundle descriptor contains duplicate paths'];
  }
  try {
    const metadata = await lstat(root);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return ['bundle root is not a regular directory'];
    }
    if ((metadata.mode & 0o222) !== 0) return ['bundle root is writable'];
    const actual = (await inspectBundleDirectory(root)).sort((left, right) =>
      left.path.localeCompare(right.path),
    );
    const expected = [...declaredFiles].sort((left, right) => left.path.localeCompare(right.path));
    return canonicalJson(actual) === canonicalJson(expected)
      ? []
      : ['bundle file set or digest differs from its descriptor'];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

export function classifyAttackSurface(path) {
  if (/^(?:\.github\/|scripts\/|tooling\/quality\/|spec\/schemas\/)/.test(path)) {
    return 'verifier-or-policy';
  }
  if (/^(?:packages\/protocol|packages\/core)\//.test(path)) return 'protocol-or-kernel';
  if (/^(?:apps\/runtime-node|packages\/plugin-sdk)\//.test(path)) return 'runtime-or-plugin';
  if (/(?:^|\/)(?:auth|secret|permission|sandbox|lock|integrity)(?:[./_-]|$)/i.test(path)) {
    return 'security-or-concurrency';
  }
  if (/(?:\.test\.|\.spec\.|\/fixtures\/)/.test(path)) return 'test-or-fixture';
  return 'changed-surface';
}

const typeScriptPath = /\.(?:[cm]?ts|tsx)$/;

const resolveImport = (from, specifier, knownPaths) => {
  if (!specifier.startsWith('.')) return null;
  const unresolved = posix.normalize(posix.join(posix.dirname(from), specifier));
  const base = unresolved.replace(/\.[cm]?js$/, '');
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
};

export function deriveAttackSurfaces(sources, changedPaths) {
  const knownPaths = new Set(sources.keys());
  const dependents = new Map();
  for (const [path, source] of sources) {
    if (!typeScriptPath.test(path)) continue;
    for (const imported of ts.preProcessFile(source).importedFiles) {
      const dependency = resolveImport(path, imported.fileName, knownPaths);
      if (!dependency) continue;
      const entries = dependents.get(dependency) ?? new Set();
      entries.add(path);
      dependents.set(dependency, entries);
    }
  }
  const changed = new Set(changedPaths);
  const affected = new Set(changedPaths);
  const queue = changedPaths.filter((path) => typeScriptPath.test(path));
  while (queue.length > 0) {
    const path = queue.shift();
    for (const dependent of dependents.get(path) ?? []) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      queue.push(dependent);
    }
  }
  return [...affected].sort().map((path) => ({
    path,
    class: classifyAttackSurface(path),
    origin: changed.has(path) ? 'changed' : 'dependent',
  }));
}

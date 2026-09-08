import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  authoritativeAttempts,
  canonicalJson,
  classifyAttackSurface,
  deriveAttackSurfaces,
  digestBytes,
  digestJson,
  replayLedger,
  validateAttestation,
  validateBundleDirectory,
  validateEvidenceReference,
  validateRoleIdentities,
  validTransition,
  withoutKey,
} from './role-evidence-policy.mjs';

const candidateRevision = `sha256:${'a'.repeat(64)}`;
const digest = `sha256:${'b'.repeat(64)}`;
const baseAttempt = {
  schemaVersion: 1,
  sequence: 1,
  attemptId: 'attempt-reviewer',
  parentInvocationId: 'parent-1',
  implementerId: 'implementer',
  producerId: 'reviewer-agent',
  role: 'reviewer',
  promptId: 'reviewer-v1',
  promptDigest: digest,
  modelClass: 'quick',
  candidateRevision,
  inputManifestRef: '.agent/role-inputs/reviewer.json',
  inputManifestDigest: digest,
  sourceAccessMode: 'contract-diff',
  state: 'reserved',
  attestationStrength: 'host-attested',
  toolTraceRefs: [],
  unresolvedFindingCount: 0,
  recordedAt: '2026-01-01T00:00:00.000Z',
};

const transition = (attempt, state, sequence) => ({ ...attempt, state, sequence });

test('canonical JSON is independent of object insertion order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(digestJson({ a: 1, b: 2 }), digestJson({ b: 2, a: 1 }));
});

test('ledger replay requires contiguous append-only transitions', () => {
  const valid = [baseAttempt, transition(baseAttempt, 'running', 2)];
  assert.deepEqual(replayLedger(valid, candidateRevision).failures, []);
  assert.match(
    replayLedger([transition(baseAttempt, 'running', 1)], candidateRevision).failures[0],
    /must start reserved/,
  );
  assert.ok(
    replayLedger(
      [baseAttempt, transition(baseAttempt, 'completed', 2)],
      candidateRevision,
    ).failures.some((failure) => /cannot transition/.test(failure)),
  );
  assert.equal(validTransition('completed', 'running'), false);
  assert.match(
    replayLedger(
      [baseAttempt, transition(baseAttempt, 'running', 2), transition(baseAttempt, 'completed', 3)],
      candidateRevision,
    ).failures[0],
    /without bound Evidence/,
  );
});

test('authoritative attempts require completed zero-finding role attempts', () => {
  const entries = [];
  ['reviewer', 'hardener', 'qa'].forEach((role, index) => {
    const reserved = {
      ...baseAttempt,
      sequence: index * 3 + 1,
      attemptId: `attempt-${role}`,
      producerId: `${role}-agent`,
      role,
      sourceAccessMode: role === 'qa' ? 'source-blind-bundle' : 'contract-diff',
    };
    entries.push(reserved, transition(reserved, 'running', index * 3 + 2), {
      ...transition(reserved, 'completed', index * 3 + 3),
      reportRef: `${role}.json`,
      reportDigest: digest,
      attestationRef: `${role}-attestation.json`,
      attestationDigest: digest,
    });
  });
  const result = authoritativeAttempts(entries, candidateRevision);
  assert.deepEqual(result.failures, []);
  assert.equal(result.attempts.size, 3);
  assert.deepEqual(validateRoleIdentities(result.attempts, 'implementer'), []);
  assert.match(validateRoleIdentities(result.attempts, 'qa-agent')[0], /Implementer/);
});

test('attestation validation binds identity and validity window', () => {
  const attempt = transition(baseAttempt, 'running', 2);
  const envelope = {
    ...attempt,
    issuer: 'promptiris.host',
    verifierId: 'promptiris.role-verifier',
    nativeProofRef: 'proof.json',
    nativeProofDigest: digest,
    subject: 'reviewer-agent',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    nonce: '0123456789abcdef',
  };
  const registry = { issuers: ['promptiris.host'], verifiers: ['promptiris.role-verifier'] };
  assert.deepEqual(validateAttestation(envelope, attempt, registry, Date.UTC(2026, 1, 1)), []);
  assert.match(
    validateAttestation({ ...envelope, producerId: 'other' }, attempt, registry, 0)[0],
    /producerId/,
  );
});

test('evidence references reject absolute and escaping paths before reading', async () => {
  assert.deepEqual(await validateEvidenceReference('.', '/etc/passwd', digest), [
    'evidence reference is not repository-relative',
  ]);
  assert.deepEqual(await validateEvidenceReference('.', '../outside', digest), [
    'evidence reference is not repository-relative',
  ]);
});

test('bundle validation requires an exact immutable regular-file tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promptiris-bundle-'));
  await writeFile(join(root, 'public.txt'), 'public\n');
  await chmod(join(root, 'public.txt'), 0o444);
  await chmod(root, 0o555);
  const files = [{ path: 'public.txt', digest: digestBytes('public\n') }];
  assert.deepEqual(await validateBundleDirectory(root, files), []);
  assert.match(
    (await validateBundleDirectory(root, [...files, { path: '../escape', digest }]))[0],
    /unsafe path/,
  );
  assert.match((await validateBundleDirectory(root, []))[0], /file set or digest/);
});

test('attack surfaces are classified deterministically', () => {
  assert.equal(classifyAttackSurface('scripts/verify-candidate'), 'verifier-or-policy');
  assert.equal(classifyAttackSurface('packages/core/src/kernel.ts'), 'protocol-or-kernel');
  assert.equal(classifyAttackSurface('packages/x/src/x.test.ts'), 'test-or-fixture');
  const sources = new Map([
    ['packages/x/src/value.ts', 'export const value = 1;'],
    ['packages/x/src/index.ts', "export { value } from './value.js';"],
    ['packages/x/src/consumer.ts', "import { value } from './index.js'; void value;"],
  ]);
  assert.deepEqual(
    deriveAttackSurfaces(sources, ['packages/x/src/value.ts']).map(({ path, origin }) => ({
      path,
      origin,
    })),
    [
      { path: 'packages/x/src/consumer.ts', origin: 'dependent' },
      { path: 'packages/x/src/index.ts', origin: 'dependent' },
      { path: 'packages/x/src/value.ts', origin: 'changed' },
    ],
  );
});

const repositoryRoot = process.cwd();

const copy = async (workspace, path) => {
  const destination = join(workspace, path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(repositoryRoot, path), destination, { recursive: true });
};

const run = (workspace, arguments_, options = {}) =>
  execFileSync(process.execPath, arguments_, {
    cwd: workspace,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
    stdio: options.stdio,
  });

const git = (workspace, arguments_) =>
  execFileSync('git', arguments_, { cwd: workspace, encoding: 'utf8' }).trim();

test('role interface guides and enforces attempt preparation', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'promptiris-role-interface-'));
  for (const path of [
    'scripts/agent-role',
    'scripts/bind-role-evidence.mjs',
    'scripts/finalize-candidate.mjs',
    'scripts/verify-role-evidence.mjs',
    'spec/schemas',
    'tooling/quality/evidence-file.mjs',
    'tooling/quality/role-evidence-policy.mjs',
    'tooling/roles',
  ]) {
    await copy(workspace, path);
  }
  await symlink(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'));
  await mkdir(join(workspace, '.scratch/test/issues'), { recursive: true });
  await mkdir(join(workspace, '.agent/claims'), { recursive: true });
  await mkdir(join(workspace, 'packages/example/src'), { recursive: true });
  await writeFile(
    join(workspace, '.scratch/test/issues/01-role.md'),
    '# Role test\n\nStatus: in-progress\nBranch: `roles-test`\n',
  );
  await writeFile(join(workspace, 'README.md'), '# Public\n');
  await writeFile(join(workspace, 'packages/example/src/index.ts'), 'export const value = 1;\n');
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'user.email', 'test@example.test']);
  git(workspace, ['config', 'user.name', 'test']);
  git(workspace, ['checkout', '-q', '-b', 'roles-test']);
  git(workspace, ['add', '.']);
  git(workspace, ['commit', '-qm', 'test fixture']);
  const baseRevision = git(workspace, ['rev-parse', 'HEAD']);
  await writeFile(
    join(workspace, '.scratch/test/issues/01-role.md'),
    '# Role test\n\nStatus: in-progress\nBranch: `roles-test`\n\nExample: Branch: `roles-test`\n',
  );
  await writeFile(join(workspace, 'packages/example/src/index.ts'), 'export const value = 2;\n');
  git(workspace, ['add', '.']);
  git(workspace, ['commit', '-qm', 'candidate']);
  await writeFile(
    join(workspace, '.agent/claims/roles-test.json'),
    `${JSON.stringify({
      taskId: '.scratch/test/issues/01-role.md',
      branch: 'roles-test',
      agentId: 'implementer',
      expiresAtEpochMs: Date.now() + 60_000,
    })}\n`,
  );
  const env = {
    PROMPTIRIS_AGENT_ROOT: join(workspace, '.agent'),
    PROMPTIRIS_BASE_REVISION: baseRevision,
  };

  const before = JSON.parse(run(workspace, ['scripts/agent-role', 'status'], { env }));
  assert.equal(before.state, 'candidate-not-frozen');
  assert.match(before.nextActions[0], /candidate:finalize/);
  run(
    workspace,
    ['scripts/finalize-candidate.mjs', 'finalize', '.scratch/test/issues/01-role.md'],
    { env },
  );

  assert.throws(
    () =>
      run(
        workspace,
        ['scripts/agent-role', 'prepare', 'reviewer', 'implementer', 'quick', 'parent-1'],
        { env, stdio: 'pipe' },
      ),
    (error) => error.stderr.includes('ROLE_SELF_ASSIGNMENT') && error.stderr.includes('Next:'),
  );
  const prepared = JSON.parse(
    run(
      workspace,
      ['scripts/agent-role', 'prepare', 'reviewer', 'reviewer-agent', 'quick', 'parent-1'],
      { env },
    ),
  );
  const manifest = JSON.parse(await readFile(prepared.manifestRef, 'utf8'));
  assert.equal(manifest.manifestDigest, digestJson(withoutKey(manifest, 'manifestDigest')));
  assert.equal(manifest.producerId, 'reviewer-agent');
  const canonicalWorkspace = await realpath(workspace);
  assert.equal(prepared.inputRoots.repository, canonicalWorkspace);
  assert.equal(prepared.inputRoots.agentState, canonicalWorkspace);
  assert.equal(prepared.resolvedInputs.length, manifest.inputs.length);
  for (const input of prepared.resolvedInputs) {
    assert.equal(digestBytes(await readFile(input.path)), input.digest);
  }
  const reportTemplate = JSON.parse(await readFile(prepared.reportTemplateRef, 'utf8'));
  assert.equal(reportTemplate.producerId, 'reviewer-agent');
  assert.equal(reportTemplate.verdict, 'changes-required');
  assert.equal(reportTemplate.candidateRevision, undefined);
  const status = JSON.parse(run(workspace, ['scripts/agent-role', 'status'], { env }));
  assert.deepEqual(status.completedRoles, []);
  assert.ok(status.missingRoles.includes('reviewer'));

  assert.throws(
    () =>
      run(
        workspace,
        ['scripts/agent-role', 'record', 'reviewer', prepared.attemptId, 'completed'],
        { env, stdio: 'pipe' },
      ),
    (error) => error.stderr.includes('ROLE_TRANSITION_RESERVED'),
  );
  run(workspace, ['scripts/agent-role', 'record', 'reviewer', prepared.attemptId, 'failed', '1'], {
    env,
  });
  assert.throws(
    () =>
      run(
        workspace,
        ['scripts/agent-role', 'record', 'reviewer', prepared.attemptId, 'failed', '1'],
        { env, stdio: 'pipe' },
      ),
    (error) => error.stderr.includes('ROLE_LEDGER_INVALID'),
  );
  run(workspace, ['scripts/agent-role', 'unsupported', 'qa', 'host has no isolated workers'], {
    env,
  });
  assert.throws(
    () =>
      run(workspace, ['scripts/agent-role', 'unsupported', 'qa', 'duplicate declaration'], {
        env,
        stdio: 'pipe',
      }),
    (error) => error.stderr.includes('ROLE_UNSUPPORTED_ALREADY_RECORDED'),
  );
});

test('binding and verification require three attested independent roles', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'promptiris-role-verifier-'));
  for (const path of [
    'scripts/agent-role',
    'scripts/bind-role-evidence.mjs',
    'scripts/finalize-candidate.mjs',
    'scripts/verify-role-evidence.mjs',
    'spec/schemas',
    'tooling/quality/evidence-file.mjs',
    'tooling/quality/role-evidence-policy.mjs',
    'tooling/roles',
  ]) {
    await copy(workspace, path);
  }
  await symlink(join(repositoryRoot, 'node_modules'), join(workspace, 'node_modules'));
  const packet = '.scratch/test/issues/01-role.md';
  const evidenceDirectory = '.scratch/test/issues/01-role.evidence';
  await mkdir(join(workspace, dirname(packet)), { recursive: true });
  await mkdir(join(workspace, evidenceDirectory), { recursive: true });
  await mkdir(join(workspace, '.agent/claims'), { recursive: true });
  await mkdir(join(workspace, 'packages/example/src'), { recursive: true });
  await writeFile(
    join(workspace, packet),
    '# Role test\n\nStatus: in-progress\nBranch: `roles-test`\n',
  );
  await writeFile(join(workspace, 'README.md'), '# Public\n');
  await writeFile(join(workspace, 'packages/example/src/index.ts'), 'export const value = 1;\n');
  git(workspace, ['init', '-q']);
  git(workspace, ['config', 'user.email', 'test@example.test']);
  git(workspace, ['config', 'user.name', 'test']);
  git(workspace, ['checkout', '-q', '-b', 'roles-test']);
  git(workspace, ['add', '.']);
  git(workspace, ['commit', '-qm', 'test fixture']);
  const baseRevision = git(workspace, ['rev-parse', 'HEAD']);
  await writeFile(
    join(workspace, packet),
    '# Role test\n\nStatus: in-progress\nBranch: `roles-test`\n\nExample: Branch: `roles-test`\n',
  );
  await writeFile(join(workspace, 'packages/example/src/index.ts'), 'export const value = 2;\n');
  git(workspace, ['add', packet, 'packages/example/src/index.ts']);
  git(workspace, ['commit', '-qm', 'candidate']);
  await writeFile(
    join(workspace, '.agent/claims/roles-test.json'),
    `${JSON.stringify({
      taskId: packet,
      branch: 'roles-test',
      agentId: 'implementer',
      expiresAtEpochMs: Date.now() + 60_000,
    })}\n`,
  );
  const env = {
    PROMPTIRIS_AGENT_ROOT: join(workspace, '.agent'),
    PROMPTIRIS_BASE_REVISION: baseRevision,
  };
  const gateLog = 'deterministic gate passed\n';
  const gateDigest = digestBytes(gateLog).replace('sha256:', '');
  await mkdir(join(workspace, '.agent/traces'), { recursive: true });
  await mkdir(join(workspace, '.agent/logs'), { recursive: true });
  await writeFile(join(workspace, '.agent/logs/test-gate.log'), gateLog);
  await writeFile(
    join(workspace, '.agent/traces/test-gate.json'),
    `${JSON.stringify({
      taskId: 'test.gate',
      providerId: 'test-runner',
      exitCode: 0,
      context: {
        branch: 'roles-test',
        candidateRevision: git(workspace, ['rev-parse', 'HEAD']),
        dirty: false,
      },
      evidence: { ref: '.agent/logs/test-gate.log', sha256: gateDigest },
    })}\n`,
  );
  run(workspace, ['scripts/finalize-candidate.mjs', 'finalize', packet], { env });

  for (const [index, role] of ['reviewer', 'hardener', 'qa'].entries()) {
    const producerId = `${role}-agent`;
    const prepared = JSON.parse(
      run(workspace, ['scripts/agent-role', 'prepare', role, producerId, 'quick', 'parent-1'], {
        env,
      }),
    );
    const manifest = JSON.parse(await readFile(prepared.manifestRef, 'utf8'));
    if (role === 'qa') {
      const bundlePath = prepared.resolvedInputs.find(
        ({ kind }) => kind === 'source-blind-bundle',
      ).path;
      const bundleInput = manifest.inputs.find(({ kind }) => kind === 'source-blind-bundle');
      assert.equal(bundleInput.files, undefined);
      assert.equal(
        bundleInput.bundle.files.some(({ path }) => path.startsWith('scripts/')),
        false,
      );
      assert.match(
        execFileSync(join(bundlePath, 'bin/agent-role'), ['status'], {
          cwd: bundlePath,
          encoding: 'utf8',
          env: {
            PATH: process.env.PATH,
            ...prepared.resolvedInputs.find(({ kind }) => kind === 'source-blind-bundle')
              .environment,
          },
        }),
        /roles-incomplete/,
      );
      assert.throws(() =>
        execFileSync(join(bundlePath, 'bin/agent-role'), ['invalid'], {
          cwd: bundlePath,
          env: {
            PATH: process.env.PATH,
            ...prepared.resolvedInputs.find(({ kind }) => kind === 'source-blind-bundle')
              .environment,
          },
          stdio: 'pipe',
        }),
      );
    }
    const proofRef = `${evidenceDirectory}/${role}-proof.json`;
    const proof = `${JSON.stringify({ role, producerId })}\n`;
    await writeFile(join(workspace, proofRef), proof);
    const envelopePath = join(workspace, evidenceDirectory, `${role}-envelope-input.json`);
    await writeFile(
      envelopePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          issuer: 'promptiris.host',
          verifierId: 'promptiris.role-verifier',
          nativeProofRef: proofRef,
          nativeProofDigest: digestBytes(proof),
          subject: producerId,
          producerId,
          attemptId: prepared.attemptId,
          parentInvocationId: 'parent-1',
          role,
          candidateRevision: manifest.candidateRevision,
          promptDigest: manifest.promptDigest,
          inputManifestDigest: manifest.manifestDigest,
          sourceAccessMode: manifest.sourceAccessMode,
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2099-01-01T00:00:00.000Z',
          nonce: `${role}-nonce-000000${index}`,
          attestationStrength: 'host-attested',
        },
        null,
        2,
      )}\n`,
    );
    run(workspace, ['scripts/agent-role', 'external', role, envelopePath], { env });
    const evidence = [
      {
        checkId: `${role}-proof`,
        status: 'passed',
        evidenceRef: proofRef,
        evidenceSha256: digestBytes(proof).replace('sha256:', ''),
      },
    ];
    const report =
      role === 'reviewer'
        ? {
            schemaVersion: 1,
            producerId,
            independent: true,
            verdict: 'pass',
            findings: [],
            commentDecisions: [],
            evidence,
            residualRisks: [],
          }
        : {
            schemaVersion: 1,
            role,
            producerId,
            status: 'passed',
            ...(role === 'qa' ? { sourceBlind: true } : {}),
            ...(role === 'hardener'
              ? {
                  surfaceCoverage: manifest.inputs
                    .find(({ kind }) => kind === 'attack-surfaces')
                    .surfaces.map(({ path }) => ({
                      path,
                      scenario: 'validated by fixture proof',
                      evidenceCheckId: `${role}-proof`,
                    })),
                }
              : {}),
            scenarios: [`${role} scenario`],
            evidence,
          };
    await writeFile(
      join(workspace, evidenceDirectory, `${role}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    run(workspace, ['scripts/bind-role-evidence.mjs', role], { env });
  }

  git(workspace, ['add', '.scratch']);
  git(workspace, ['commit', '-qm', 'role evidence']);
  const output = run(workspace, ['scripts/verify-role-evidence.mjs'], { env });
  assert.match(output, /Role evidence passed/);

  const reviewerPath = join(workspace, evidenceDirectory, 'reviewer.json');
  const reviewer = JSON.parse(await readFile(reviewerPath, 'utf8'));
  delete reviewer.attemptId;
  await writeFile(reviewerPath, `${JSON.stringify(reviewer, null, 2)}\n`);
  git(workspace, ['add', reviewerPath]);
  git(workspace, ['commit', '-qm', 'tamper evidence']);
  assert.throws(
    () => run(workspace, ['scripts/verify-role-evidence.mjs'], { env, stdio: 'pipe' }),
    (error) =>
      error.stderr.includes('ROLE_EVIDENCE_DIGEST_MISMATCH') && error.stderr.includes('Next:'),
  );
});

const ajv = new Ajv2020({ strict: true });
ajv.addFormat('date-time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
const schema = async (name) =>
  JSON.parse(await readFile(`spec/schemas/${name}.schema.json`, 'utf8'));

test('attempt requires provenance and completed evidence bindings', async () => {
  const validate = ajv.compile(await schema('role-attempt'));
  const base = {
    schemaVersion: 1,
    attemptId: 'attempt-a',
    parentInvocationId: 'p',
    implementerId: 'i',
    producerId: 'r',
    role: 'reviewer',
    promptId: 'reviewer-v1',
    promptDigest: digest,
    modelClass: 'quick',
    candidateRevision: 'c',
    inputManifestRef: '.agent/role-inputs/reviewer.json',
    inputManifestDigest: digest,
    sourceAccessMode: 'contract-diff',
    state: 'reserved',
    attestationStrength: 'host-attested',
    recordedAt: '2026-09-07T10:00:00Z',
    unresolvedFindingCount: 0,
    sequence: 1,
  };
  assert.equal(validate(base), true);
  assert.equal(validate({ ...base, state: 'completed' }), false);
  assert.equal(validate({ ...base, modelClass: 'cheap' }), false);
});

test('attestation restricts access mode and validates dates', async () => {
  const validate = ajv.compile(await schema('role-attestation-envelope'));
  const base = {
    schemaVersion: 1,
    issuer: 'promptiris.host',
    verifierId: 'promptiris.role-verifier',
    nativeProofRef: 'proof',
    nativeProofDigest: digest,
    subject: 'candidate',
    producerId: 'r',
    attemptId: 'attempt-a',
    parentInvocationId: 'p',
    role: 'reviewer',
    candidateRevision: 'c',
    promptDigest: digest,
    inputManifestDigest: digest,
    sourceAccessMode: 'contract-diff',
    issuedAt: '2026-09-07T10:00:00Z',
    expiresAt: '2026-09-08T10:00:00Z',
    nonce: '1234567890123456',
    attestationStrength: 'host-attested',
  };
  assert.equal(validate(base), true);
  assert.equal(validate({ ...base, sourceAccessMode: 'filesystem' }), false);
  assert.equal(validate({ ...base, issuedAt: 'tomorrow' }), false);
});

test('input manifests require complete Candidate and role bindings', async () => {
  const validate = ajv.compile(await schema('role-input-manifest'));
  const manifest = {
    schemaVersion: 1,
    taskId: '.scratch/test.md',
    baseRevision: 'a'.repeat(40),
    candidateRevision: digest,
    promptRef: 'tooling/roles/prompts/reviewer.md',
    promptId: 'reviewer-v1',
    promptDigest: digest,
    producerId: 'reviewer-agent',
    implementerId: 'implementer',
    parentInvocationId: 'parent-1',
    attemptId: 'attempt-a',
    role: 'reviewer',
    modelClass: 'quick',
    sourceAccessMode: 'contract-diff',
    inputs: [{ kind: 'work-item', ref: '.scratch/test.md', digest }],
    manifestDigest: digest,
  };
  assert.equal(validate(manifest), true);
  assert.equal(validate({ ...manifest, producerId: undefined }), false);
  assert.equal(validate({ ...manifest, inputs: [] }), false);
});

test('role ledgers require Candidate identity and structured entries', async () => {
  const isolatedAjv = new Ajv2020({ strict: true });
  isolatedAjv.addFormat('date-time', /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
  isolatedAjv.addSchema(await schema('role-attempt'));
  const validate = isolatedAjv.compile(await schema('role-ledger'));
  const ledger = {
    schemaVersion: 1,
    taskId: '.scratch/test.md',
    branch: 'test-role',
    candidateRevision: digest,
    entries: [],
    attestations: [],
    unsupported: [],
  };
  assert.equal(validate(ledger), true);
  assert.equal(validate({ ...ledger, branch: undefined }), false);
  assert.equal(validate({ ...ledger, entries: [{}] }), false);
});

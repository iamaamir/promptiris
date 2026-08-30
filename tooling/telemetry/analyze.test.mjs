import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { analyzeTelemetry } from './analyze.mjs';

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-prompt-telemetry-'));
  await mkdir(join(root, '.agent/traces'), { recursive: true });
  await mkdir(join(root, '.agent/reports'), { recursive: true });
  await mkdir(join(root, 'tooling'), { recursive: true });
  await mkdir(join(root, 'tooling/quality'), { recursive: true });
  await writeFile(
    join(root, 'tooling/capabilities.json'),
    JSON.stringify({
      capabilities: {
        textual_search: { providers: ['rg'], costClass: 'very_low', contextClass: 'low' },
        output_reduction: { providers: ['rtk'], costClass: 'very_low', contextClass: 'low' },
      },
      executionRoles: {
        discovery: ['textual_search'],
        gate: ['output_reduction'],
      },
      providers: {
        rg: { name: 'Ripgrep', group: 'Retrieval', capabilities: ['textual_search'] },
        rtk: { name: 'RTK', group: 'Reduction', capabilities: ['output_reduction'] },
        codeql: {
          name: 'CodeQL',
          group: 'Security',
          capabilities: ['data_flow_analysis'],
          scope: 'ci-only',
        },
      },
    }),
  );
  await writeFile(
    join(root, 'tooling/quality/mutation-policy.json'),
    JSON.stringify({
      schemaVersion: 1,
      baselineDate: '2026-08-28',
      aggregate: { minScore: 50, maxIgnored: 0, maxSurvived: 1, maxNoCoverage: 0 },
      targets: {
        'a.ts': { minScore: 50, maxIgnored: 0, maxSurvived: 1, maxNoCoverage: 0 },
      },
    }),
  );
  return root;
};

test('excludes unsupported historical traces from current aggregates', async () => {
  const root = await fixture();
  await writeFile(
    join(root, '.agent/traces/legacy.json'),
    JSON.stringify({
      schemaVersion: 1,
      traceId: 'old',
      taskId: 'verify.lint',
      command: 'pnpm',
      startedAtEpochMs: 1,
      durationMs: 10,
      exitCode: 0,
      rawOutputBytes: 400,
    }),
  );
  await writeFile(
    join(root, '.agent/traces/current.json'),
    JSON.stringify({
      schemaVersion: 2,
      traceId: 'new',
      runId: 'run-1',
      taskId: 'search',
      providerId: 'search-router',
      tools: ['rg', 'unregistered-tool'],
      executor: 'rg',
      startedAtEpochMs: 2,
      durationMs: 5,
      exitCode: 0,
      output: {
        rawBytes: 400,
        modelVisibleBytes: 40,
        reducedBytes: 360,
        estimatedRawTokens: 100,
        estimatedModelVisibleTokens: 10,
        estimatedTokensAvoided: 90,
      },
      evidence: { ref: '.agent/logs/new.log' },
    }),
  );
  const report = await analyzeTelemetry({ root });
  assert.equal(report.summary.traceCount, 1);
  assert.equal(report.summary.reducedBytes, 360);
  assert.equal(report.dataQuality.exactTraceCount, 1);
  assert.equal(report.dataQuality.preRedactionTraceCount, 1);
  assert.equal(report.dataQuality.recordedRedactionCount, 0);
  assert.equal(report.usage.tools[0].id, 'rg');
  assert.equal(
    report.usage.capabilities.find((item) => item.id === 'output_reduction').utilization,
    'unobserved',
  );
  assert.equal(report.usage.inventory.find((item) => item.id === 'rg').state, 'active');
  assert.deepEqual(report.usage.inventory.find((item) => item.id === 'rg').executionRoles, [
    'discovery',
  ]);
  assert.equal(report.usage.inventory.find((item) => item.id === 'codeql').state, 'ci-only');
  assert.equal(
    report.usage.inventory.find((item) => item.id === 'unregistered-tool').state,
    'unregistered',
  );
});

test('summarizes verification runs and mutation evidence', async () => {
  const root = await fixture();
  await mkdir(join(root, '.scratch/example/evidence'), { recursive: true });
  await writeFile(
    join(root, '.scratch/example/evidence/qa.json'),
    JSON.stringify({
      taskId: '.scratch/example/issues/01.md',
      role: 'qa',
      producerId: 'qa-a',
      candidateRevision: `sha256:${'a'.repeat(64)}`,
      status: 'passed',
    }),
  );
  await writeFile(
    join(root, '.agent/reports/verification-runs.jsonl'),
    `${JSON.stringify({ runId: 'r1', profile: 'full', status: 'passed', startedAt: '2026-08-27T00:00:00Z' })}\n`,
  );
  await writeFile(
    join(root, '.agent/reports/mutation.json'),
    JSON.stringify({
      files: {
        'a.ts': {
          mutants: [{ status: 'Killed' }, { status: 'Survived' }, { status: 'CompileError' }],
        },
      },
      thresholds: { high: 90, low: 80, break: 75 },
    }),
  );
  await writeFile(
    join(root, '.agent/reports/go-coverage.out'),
    'mode: set\nexample/main.go:1.1,2.1 3 1\nexample/main.go:3.1,4.1 1 0\n',
  );
  const report = await analyzeTelemetry({ root });
  assert.equal(report.summary.latestVerification.status, 'passed');
  assert.equal(report.summary.latestVerification.telemetry.traceCount, 0);
  assert.equal(report.quality.mutation.total, 3);
  assert.equal(report.quality.mutation.score, 50);
  assert.equal(report.quality.mutation.policy.status, 'stable');
  assert.equal(report.quality.mutation.targets[0].survived, 1);
  assert.equal(report.quality.goCoverage.percent, 75);
  assert.equal(report.quality.goCoverage.meetsTarget, false);
  assert.equal(report.quality.roles.passedCount, 1);
});

test('ignores stale coverage outside canonical workspaces', async () => {
  const root = await fixture();
  const canonical = join(root, 'packages', 'core', 'coverage');
  const stale = join(root, 'coverage');
  await mkdir(canonical, { recursive: true });
  await mkdir(stale, { recursive: true });
  const covered = {
    '/source.ts': { s: { 0: 1 }, f: { 0: 1 }, b: { 0: [1, 1] } },
  };
  const uncovered = {
    '/stale.ts': { s: { 0: 0 }, f: { 0: 0 }, b: { 0: [0, 0] } },
  };
  await writeFile(join(canonical, 'coverage-final.json'), JSON.stringify(covered));
  await writeFile(join(stale, 'coverage-final.json'), JSON.stringify(uncovered));

  const report = await analyzeTelemetry({ root });
  assert.equal(report.quality.coverage.reportCount, 1);
  assert.equal(report.quality.coverage.statements.percent, 100);
});

test('aggregates and attributes traces across worktrees without duplication', async () => {
  const root = await fixture();
  const otherAgentRoot = join(root, 'other-worktree', '.agent');
  await mkdir(join(otherAgentRoot, 'traces'), { recursive: true });
  const trace = (traceId, worktreeId, agentId) => ({
    schemaVersion: 3,
    traceId,
    runId: 'parallel-run',
    taskId: 'verify.unit',
    providerId: 'test-runner',
    tools: ['vitest'],
    executor: 'pnpm',
    startedAtEpochMs: 2,
    durationMs: 5,
    exitCode: 0,
    context: {
      repositoryId: '0123456789abcdef',
      worktreeId,
      branch: `branch-${worktreeId}`,
      candidateRevision: 'a'.repeat(40),
      workspaceDigest: `sha256:${'b'.repeat(64)}`,
      dirty: false,
      agentId,
    },
    output: {
      rawBytes: 40,
      modelVisibleBytes: 20,
      reducedBytes: 20,
      estimatedRawTokens: 10,
      estimatedModelVisibleTokens: 5,
      estimatedTokensAvoided: 5,
    },
    evidence: { ref: `.agent/logs/${traceId}.log` },
  });
  await writeFile(
    join(root, '.agent/traces/shared.json'),
    JSON.stringify(trace('shared', '1111111111111111', 'agent-a')),
  );
  await writeFile(
    join(otherAgentRoot, 'traces/other.json'),
    JSON.stringify(trace('other', '2222222222222222', 'agent-b')),
  );
  await writeFile(
    join(otherAgentRoot, 'traces/duplicate.json'),
    JSON.stringify(trace('shared', '1111111111111111', 'agent-a')),
  );

  const report = await analyzeTelemetry({
    root,
    agentRoots: [join(root, '.agent'), otherAgentRoot],
  });
  assert.equal(report.summary.traceCount, 2);
  assert.equal(report.dataQuality.worktreeCount, 2);
  assert.equal(report.dataQuality.agentCount, 2);
  assert.equal(report.dataQuality.unattributedTraceCount, 0);
  assert.deepEqual(
    report.usage.agents.map(({ id, calls }) => ({ id, calls })),
    [
      { id: 'agent-a', calls: 1 },
      { id: 'agent-b', calls: 1 },
    ],
  );
});

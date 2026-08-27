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
  await writeFile(
    join(root, 'tooling/capabilities.json'),
    JSON.stringify({
      capabilities: {
        textual_search: { providers: ['rg'], costClass: 'very_low', contextClass: 'low' },
        output_reduction: { providers: ['rtk'], costClass: 'very_low', contextClass: 'low' },
      },
    }),
  );
  return root;
};

test('separates exact v2 reductions from legacy traces', async () => {
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
      tools: ['rg'],
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
  assert.equal(report.summary.traceCount, 2);
  assert.equal(report.summary.reducedBytes, 360);
  assert.equal(report.dataQuality.legacyTraceCount, 1);
  assert.equal(report.dataQuality.exactTraceCount, 1);
  assert.equal(report.usage.tools[0].id, 'rg');
  assert.equal(
    report.usage.capabilities.find((item) => item.id === 'output_reduction').utilization,
    'unobserved',
  );
});

test('summarizes verification runs and mutation evidence', async () => {
  const root = await fixture();
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
  assert.equal(report.quality.goCoverage.percent, 75);
  assert.equal(report.quality.goCoverage.meetsTarget, false);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mutationSummary } from './mutation-report.mjs';

const report = {
  files: {
    'a.ts': {
      mutants: [
        { status: 'Killed' },
        { status: 'Survived' },
        { status: 'NoCoverage' },
        { status: 'Ignored' },
        { status: 'CompileError' },
      ],
    },
  },
  thresholds: { high: 95, low: 90, break: 90 },
};

test('summarizes mutation debt separately from excluded mutants', () => {
  const summary = mutationSummary(
    report,
    {
      baselineDate: '2026-08-20',
      aggregate: { minScore: 30, maxIgnored: 1, maxSurvived: 1, maxNoCoverage: 1 },
      targets: {
        'a.ts': { minScore: 30, maxIgnored: 1, maxSurvived: 1, maxNoCoverage: 1 },
      },
    },
    new Date('2026-08-28T12:00:00Z'),
  );

  assert.equal(summary.score, 33.33);
  assert.equal(summary.assessed, 3);
  assert.deepEqual(summary.debt, {
    ignored: 1,
    survived: 1,
    noCoverage: 1,
    unresolved: 2,
    baselineDate: '2026-08-20',
    ageDays: 8,
  });
  assert.equal(summary.targets[0].status, 'stable');
  assert.equal(summary.policy.status, 'stable');
});

test('reports aggregate, target, and missing-baseline regressions', () => {
  const summary = mutationSummary(report, {
    baselineDate: '2026-08-28',
    aggregate: { minScore: 90, maxIgnored: 0, maxSurvived: 0, maxNoCoverage: 0 },
    targets: {},
  });

  assert.equal(summary.policy.status, 'regressed');
  assert.deepEqual(summary.policy.regressions, [
    'aggregate score 33.33% is below 90%',
    'aggregate ignored 1 exceeds 0',
    'aggregate survived 1 exceeds 0',
    'aggregate uncovered 1 exceeds 0',
    'a.ts: target has no mutation policy baseline',
  ]);
});

test('rejects silent removal of a governed mutation target', () => {
  const summary = mutationSummary(report, {
    baselineDate: '2026-08-28',
    aggregate: { minScore: 30, maxIgnored: 1, maxSurvived: 1, maxNoCoverage: 1 },
    targets: {
      'a.ts': { minScore: 30, maxIgnored: 1, maxSurvived: 1, maxNoCoverage: 1 },
      'removed.ts': { minScore: 100, maxIgnored: 0, maxSurvived: 0, maxNoCoverage: 0 },
    },
  });

  assert.deepEqual(summary.policy.regressions, [
    'policy target is missing from mutation report: removed.ts',
  ]);
});

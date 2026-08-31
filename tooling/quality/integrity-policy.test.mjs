import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  compareMutationPolicy,
  compareMutationTargets,
  compareForbiddenAdditions,
  inspectChangedSources,
  inspectCoverageThresholds,
  inspectMutationTargetRegistration,
  inspectPatchScope,
  parseMutationTargets,
} from './integrity-policy.mjs';

test('forbidden-addition rules are monotonic', () => {
  assert.deepEqual(compareForbiddenAdditions({ patterns: ['a', 'b'] }, { patterns: ['a', 'c'] }), [
    'forbidden-addition rule removed: b',
  ]);
});

const policy = {
  aggregate: { minScore: 94, maxIgnored: 2, maxSurvived: 1, maxNoCoverage: 0 },
  targets: {
    'a.ts': { minScore: 95, maxIgnored: 1, maxSurvived: 0, maxNoCoverage: 0 },
  },
};

test('rejects mutation policy weakening and target removal', () => {
  assert.deepEqual(
    compareMutationPolicy(policy, {
      aggregate: { ...policy.aggregate, maxIgnored: 3 },
      targets: {},
    }),
    ['aggregate.maxIgnored increased from 2 to 3', 'mutation target removed from policy: a.ts'],
  );
});

test('allows monotonic mutation policy improvements', () => {
  assert.deepEqual(
    compareMutationPolicy(policy, {
      aggregate: { ...policy.aggregate, minScore: 95, maxIgnored: 1 },
      targets: {
        'a.ts': { ...policy.targets['a.ts'], minScore: 96, maxIgnored: 0 },
        'b.ts': { minScore: 92, maxIgnored: 0, maxSurvived: 0, maxNoCoverage: 0 },
      },
    }),
    [],
  );
});

test('allows exactly one safe additive mutation-target registration', () => {
  const beforeConfig = "export default { mutate: [\n    'packages/a/src/a.ts',\n  ],\n};\n";
  const target = 'packages/b/src/b.ts';
  const afterConfig = beforeConfig.replace('  ],', `    '${target}',\n  ],`);
  const beforePolicy = {
    aggregate: policy.aggregate,
    targets: { 'packages/a/src/a.ts': policy.targets['a.ts'] },
  };
  const afterPolicy = {
    aggregate: policy.aggregate,
    targets: {
      ...beforePolicy.targets,
      [target]: { minScore: 90, maxIgnored: 0, maxSurvived: 0, maxNoCoverage: 0 },
    },
  };
  assert.deepEqual(
    inspectMutationTargetRegistration({
      beforeConfig,
      afterConfig,
      beforePolicy,
      afterPolicy,
      changedFiles: [target],
    }),
    { safe: true, findings: [] },
  );
});

test('rejects mutation registration that changes aggregate policy or starts with debt', () => {
  const target = 'packages/b/src/b.ts';
  const result = inspectMutationTargetRegistration({
    beforeConfig: 'export default { mutate: [\n  ],\n};\n',
    afterConfig: `export default { mutate: [\n    '${target}',\n  ],\n};\n`,
    beforePolicy: { aggregate: policy.aggregate, targets: {} },
    afterPolicy: {
      aggregate: { ...policy.aggregate, maxSurvived: 2 },
      targets: { [target]: { minScore: 89, maxIgnored: 1, maxSurvived: 1, maxNoCoverage: 1 } },
    },
    changedFiles: [target],
  });
  assert.equal(result.safe, false);
  assert.deepEqual(result.findings, [
    'mutation registration cannot change aggregate policy',
    `mutation registration target must start at 90 percent: ${target}`,
    `mutation registration target must start without mutation debt: ${target}`,
  ]);
});

test('requires changed production sources to be mutation governed', () => {
  const targets = parseMutationTargets("export default { mutate: ['packages/a/src/a.ts'] };");
  assert.deepEqual(
    inspectChangedSources({
      changedFiles: ['packages/a/src/a.ts', 'packages/a/src/b.ts', 'packages/a/src/b.test.ts'],
      mutationTargets: targets,
      addedLines: [],
    }),
    ['changed production source is not mutation governed: packages/a/src/b.ts'],
  );
});

test('rejects removal from the executable Stryker target list', () => {
  assert.deepEqual(compareMutationTargets(new Set(['a.ts', 'b.ts']), new Set(['b.ts'])), [
    'mutation target removed from Stryker configuration: a.ts',
  ]);
});

test('enforces Work Item paths, test deletion, and immutable goldens', () => {
  assert.deepEqual(
    inspectPatchScope({
      changes: [
        { status: 'M', path: 'src/parser.ts' },
        { status: 'D', path: 'src/parser.test.ts' },
        { status: 'M', path: 'src/__snapshots__/parser.snap' },
        { status: 'A', path: 'package.json' },
      ],
      allowedPaths: ['src/**'],
    }),
    [
      'test deletion is not authorized by the Work Item: src/parser.test.ts',
      'golden artifact change is not authorized by the Work Item: src/__snapshots__/parser.snap',
      'changed path is outside Work Item scope: package.json',
    ],
  );
});

test('rejects new suppressions and skipped tests', () => {
  assert.deepEqual(
    inspectChangedSources({
      changedFiles: [],
      mutationTargets: new Set(),
      addedLines: [
        { file: 'a.test.ts', line: 4, text: `${['it', 'skip'].join('.')}('works', () => {})` },
      ],
    }),
    ['new suppression or skipped test at a.test.ts:4'],
  );
});

test('requires explicit coverage floors at or above 90 percent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-integrity-'));
  try {
    const low = join(directory, 'low-vitest.config.ts');
    const indirect = join(directory, 'indirect-vitest.config.ts');
    await writeFile(low, 'export default createVitestConfig(88);');
    await writeFile(indirect, 'export default createVitestConfig(threshold);');
    assert.deepEqual(await inspectCoverageThresholds([low, indirect]), [
      `coverage threshold below 90 percent: ${low} (88)`,
      `coverage threshold is not a reviewable numeric literal: ${indirect}`,
    ]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

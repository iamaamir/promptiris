import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const schema = JSON.parse(await readFile('spec/schemas/quality-stage-report.schema.json', 'utf8'));
const validate = new Ajv2020({ strict: true }).compile(schema);
const report = {
  schemaVersion: 1,
  role: 'qa',
  taskId: '.scratch/example/issues/01-example.md',
  baseRevision: 'a'.repeat(40),
  candidateRevision: `sha256:${'b'.repeat(64)}`,
  producerId: 'qa-a',
  status: 'passed',
  sourceBlind: true,
  scenarios: ['public CLI fallback preserves original input'],
  evidence: [
    {
      checkId: 'qa.cli-fallback',
      status: 'passed',
      evidenceRef: 'qa.log',
      evidenceSha256: 'c'.repeat(64),
    },
  ],
};

test('accepts SHA-bound source-blind QA evidence', () => {
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});

test('rejects QA that is not source blind', () => {
  assert.equal(validate({ ...report, sourceBlind: false }), false);
});

test('accepts hardener evidence without claiming source blindness', () => {
  const hardener = Object.fromEntries(
    Object.entries({ ...report, role: 'hardener' }).filter(([key]) => key !== 'sourceBlind'),
  );
  assert.equal(validate(hardener), true, JSON.stringify(validate.errors));
});

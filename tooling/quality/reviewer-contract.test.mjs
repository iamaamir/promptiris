import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const schema = JSON.parse(await readFile('spec/schemas/reviewer-report.schema.json', 'utf8'));
const validate = new Ajv2020({ strict: true }).compile(schema);

const report = {
  schemaVersion: 1,
  taskId: 'T004',
  baseRevision: 'base',
  candidateRevision: 'candidate',
  verdict: 'pass',
  findings: [],
  commentDecisions: [
    {
      commentId: 'C1',
      disposition: 'accepted',
      reason: 'Use Set to represent unique temporary-directory ownership.',
      evidenceRef: 'apps/runtime-node/src/configuration.test.ts',
    },
  ],
  evidence: [{ checkId: 'verify.full', status: 'passed', evidenceRef: '.agent/reports/run' }],
  residualRisks: [],
};

test('reviewer reports bind verdicts, comments, findings, and evidence to a candidate', () => {
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});

test('reviewer reports reject narrative-only or unlocated findings', () => {
  assert.equal(validate({ ...report, candidateRevision: undefined }), false);
  assert.equal(
    validate({
      ...report,
      findings: [{ id: 'R1', severity: 'high', summary: 'Missing exact evidence.' }],
    }),
    false,
  );
  assert.equal(
    validate({
      ...report,
      commentDecisions: [
        { commentId: 'C1', disposition: 'rejected', reason: 'Missing evidence reference.' },
      ],
    }),
    false,
  );
  assert.equal(
    validate({
      ...report,
      findings: [
        {
          id: 'R1',
          severity: 'low',
          file: 'src/example.ts',
          line: 1,
          summary: 'A passing report cannot retain findings.',
          evidenceRef: 'src/example.ts:1',
        },
      ],
    }),
    false,
  );
  assert.equal(validate({ ...report, verdict: 'changes-required' }), false);
});

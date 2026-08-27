#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { mutationSummary } from '../tooling/quality/mutation-report.mjs';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const report = await readJson('.agent/reports/mutation.json');
const policy = await readJson('tooling/quality/mutation-policy.json');
const summary = mutationSummary(report, policy);

process.stdout.write(
  `Mutation ${summary.score}% · unresolved ${summary.debt.unresolved} · ignored ${summary.debt.ignored}\n`,
);
for (const target of summary.targets) {
  process.stdout.write(
    `${target.status === 'stable' ? 'PASS' : 'FAIL'} ${target.file} ${target.score}% ` +
      `(survived ${target.survived}, uncovered ${target.noCoverage}, ignored ${target.ignored})\n`,
  );
}
if (summary.policy.regressions.length > 0) {
  for (const regression of summary.policy.regressions) process.stderr.write(`FAIL ${regression}\n`);
  process.exitCode = 1;
}

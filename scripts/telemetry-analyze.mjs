#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeTelemetry, repositoryLayout } from '../tooling/telemetry/analyze.mjs';

const outputArgument = process.argv.indexOf('--output');
const noWrite = process.argv.includes('--no-write');
const root = process.cwd();
const { sharedRoot } = repositoryLayout(root);
const output = resolve(
  outputArgument >= 0
    ? process.argv[outputArgument + 1]
    : `${sharedRoot}/.agent/reports/telemetry-summary.json`,
);
const report = await analyzeTelemetry({ root });
if (!noWrite) {
  await mkdir(dirname(output), { recursive: true });
  const temporaryOutput = `${output}.${process.pid}.tmp`;
  await writeFile(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporaryOutput, output);
}

if (process.argv.includes('--stdout')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    noWrite ? 'Telemetry report computed without writing.\n' : `Telemetry report: ${output}\n`,
  );
}

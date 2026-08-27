#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { analyzeTelemetry } from '../tooling/telemetry/analyze.mjs';

const outputArgument = process.argv.indexOf('--output');
const output = resolve(
  outputArgument >= 0 ? process.argv[outputArgument + 1] : '.agent/reports/telemetry-summary.json',
);
const report = await analyzeTelemetry({ root: process.cwd() });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

if (process.argv.includes('--stdout')) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(`Telemetry report: ${output}\n`);
}

#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const artifact = process.argv[2];
const allowed = new Set(['benchmark', 'coverage', 'crap', 'mutation']);
if (!allowed.has(artifact)) throw new Error(`unknown quality artifact: ${artifact}`);

const git = (args) => execFileSync('git', args, { cwd: resolve('.'), encoding: 'utf8' }).trim();
const reportPath = resolve('.agent/reports/quality-artifacts.json');
let report = { schemaVersion: 1, artifacts: {} };
try {
  report = JSON.parse(await readFile(reportPath, 'utf8'));
} catch {
  // A missing provenance manifest is initialized below.
}
report.artifacts ??= {};
report.artifacts[artifact] = {
  candidateRevision: git(['rev-parse', 'HEAD']),
  dirty: git(['status', '--porcelain']) !== '',
  measuredAt: new Date().toISOString(),
};
await mkdir(dirname(reportPath), { recursive: true });
const temporaryPath = `${reportPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
await rename(temporaryPath, reportPath);

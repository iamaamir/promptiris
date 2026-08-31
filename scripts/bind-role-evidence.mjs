#!/usr/bin/env node
import { readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const role = process.argv[2];
if (!['reviewer', 'hardener', 'qa'].includes(role))
  throw new Error('usage: scripts/bind-role-evidence.mjs <reviewer|hardener|qa>');

const root = resolve('.');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const branch = git(['branch', '--show-current']);
const commonGitDirectory = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const sharedRoot = commonGitDirectory.endsWith('/.git') ? commonGitDirectory.slice(0, -5) : root;
const agentRoot = process.env.PROMPTIRIS_AGENT_ROOT ?? `${sharedRoot}/.agent`;
const manifest = JSON.parse(
  await readFile(`${agentRoot}/reports/candidates/${branch}.json`, 'utf8'),
);
const packet = manifest.taskId;
execFileSync(process.execPath, ['scripts/finalize-candidate.mjs', 'check', packet], {
  cwd: root,
  env: { ...process.env, PROMPTIRIS_AGENT_ROOT: agentRoot },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const evidencePath = resolve(
  dirname(packet),
  `${basename(packet, '.md')}.evidence`,
  `${role}.json`,
);
const report = JSON.parse(await readFile(evidencePath, 'utf8'));
if ((role === 'reviewer' ? true : report.role === role) === false)
  throw new Error(`report role does not match: ${role}`);
for (const [key, value] of Object.entries({
  taskId: packet,
  baseRevision: manifest.baseRevision,
  candidateRevision: manifest.candidateRevision,
})) {
  if (report[key] !== undefined)
    throw new Error(`refusing to bind an already identified ${role} report: ${key}`);
  report[key] = value;
}
const temporaryPath = `${evidencePath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`);
await rename(temporaryPath, evidencePath);
process.stdout.write(`${evidencePath}\n`);

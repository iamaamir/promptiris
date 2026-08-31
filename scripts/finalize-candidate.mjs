#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const argumentsAfterMode = process.argv.slice(2).filter((argument) => argument !== '--');
const [mode, packet] = argumentsAfterMode;
if (!['finalize', 'check'].includes(mode) || !packet)
  throw new Error('usage: scripts/finalize-candidate.mjs <finalize|check> PACKET');

const root = resolve('.');
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const candidateIdentity = (evidenceDirectory) => {
  const baseName =
    process.env.PROMPTIRIS_BASE_REVISION ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  const baseRevision = git(['merge-base', 'HEAD', baseName]);
  const candidate = execFileSync(
    'git',
    [
      'diff',
      '--raw',
      '-z',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      baseRevision,
      'HEAD',
      '--',
      '.',
      `:(exclude)${evidenceDirectory}/**`,
    ],
    { cwd: root },
  );
  return {
    baseRevision,
    candidateRevision: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    headRevision: git(['rev-parse', 'HEAD']),
    branch: git(['branch', '--show-current']),
  };
};
const commonGitDirectory = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const sharedRoot = commonGitDirectory.endsWith('/.git') ? commonGitDirectory.slice(0, -5) : root;
const agentRoot = process.env.PROMPTIRIS_AGENT_ROOT ?? join(sharedRoot, '.agent');
const branch = git(['branch', '--show-current']);
const claimPath = join(agentRoot, 'claims', `${branch}.json`);
const claim = JSON.parse(await readFile(claimPath, 'utf8'));
if (claim.taskId !== packet) throw new Error(`claim does not own packet: ${packet}`);
if (!Number.isSafeInteger(claim.expiresAtEpochMs) || claim.expiresAtEpochMs <= Date.now())
  throw new Error(`claim is not active for branch: ${branch}`);

const packetSource = await readFile(packet, 'utf8');
if (!packetSource.split('\n').includes(`Branch: \`${branch}\``))
  throw new Error(`packet does not own branch: ${branch}`);
const evidenceDirectory = join(dirname(packet), `${basename(packet, '.md')}.evidence`);

const changedImplementation = git([
  'diff',
  '--name-only',
  'HEAD',
  '--',
  '.',
  `:(exclude)${evidenceDirectory}/**`,
  ':(exclude).agent/**',
])
  .split('\n')
  .filter(Boolean);
const untrackedImplementation = git([
  'ls-files',
  '--others',
  '--exclude-standard',
  '--',
  '.',
  `:(exclude)${evidenceDirectory}/**`,
  ':(exclude).agent/**',
])
  .split('\n')
  .filter(Boolean);
const uncommitted = [...changedImplementation, ...untrackedImplementation];
if (uncommitted.length > 0)
  throw new Error(`candidate has uncommitted implementation files: ${uncommitted.join(', ')}`);

const identity = candidateIdentity(evidenceDirectory);
const manifestPath = join(agentRoot, 'reports', 'candidates', `${branch}.json`);
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
} catch {
  manifest = null;
}

if (mode === 'check') {
  if (!manifest) throw new Error(`candidate is not finalized: ${branch}`);
  for (const key of ['taskId', 'branch', 'baseRevision', 'candidateRevision']) {
    const expected = key === 'taskId' ? packet : identity[key];
    if (manifest[key] !== expected) throw new Error(`candidate finalization is stale: ${key}`);
  }
  process.stdout.write(`${JSON.stringify(manifest)}\n`);
  process.exit(0);
}

const next = {
  schemaVersion: 1,
  taskId: packet,
  branch,
  ...identity,
  finalizedAt: new Date().toISOString(),
};
await mkdir(dirname(manifestPath), { recursive: true });
const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`);
await rename(temporaryPath, manifestPath);
process.stdout.write(`${JSON.stringify(next)}\n`);

#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';

const git = (args, options = {}) => execFileSync('git', args, options);
const branch =
  process.env.PROMPTIRIS_BRANCH ??
  process.env.GITHUB_HEAD_REF ??
  git(['branch', '--show-current'], { encoding: 'utf8' }).trim();
if (branch === 'main') {
  process.stdout.write('Role evidence is not required on the integration branch.\n');
  process.exit(0);
}

const baseName =
  process.env.PROMPTIRIS_BASE_REVISION ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
const baseRevision = git(['merge-base', 'HEAD', baseName], { encoding: 'utf8' }).trim();
const trustedMode = process.env.PROMPTIRIS_TRUSTED_MODE === 'true';

const packetFiles = [];
const collectPackets = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collectPackets(path);
    else if (entry.isFile() && entry.name.endsWith('.md')) packetFiles.push(path);
  }
};
if (trustedMode) {
  packetFiles.push(
    ...git(['ls-tree', '-r', '--name-only', baseRevision, '.scratch'], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter((path) => path.endsWith('.md')),
  );
} else {
  await collectPackets('.scratch');
}
const matchingPackets = [];
for (const path of packetFiles.sort()) {
  const source = trustedMode
    ? git(['show', `${baseRevision}:${path}`], { encoding: 'utf8' })
    : await readFile(path, 'utf8');
  if (source.split('\n').includes(`Branch: \`${branch}\``)) {
    matchingPackets.push(path);
  }
}
if (matchingPackets.length !== 1)
  throw new Error(
    `branch must have exactly one authoritative Work Item: ${branch}; found ${matchingPackets.length}`,
  );
const packet = matchingPackets[0];
if (trustedMode) {
  const candidatePacket = await readFile(packet, 'utf8');
  if (!candidatePacket.split('\n').includes(`Branch: \`${branch}\``))
    throw new Error(`candidate removed or rebound the authoritative Work Item: ${packet}`);
}
const candidatePathspec = [
  '.',
  ':(exclude).scratch/**/evidence/**',
  ':(exclude,glob).scratch/**/*.evidence/**',
];
const candidateWorktreeChanges = git(['diff', '--name-only', 'HEAD', '--', ...candidatePathspec], {
  encoding: 'utf8',
}).trim();
if (candidateWorktreeChanges)
  throw new Error(
    `candidate has uncommitted source outside evidence: ${candidateWorktreeChanges.split('\n').join(', ')}`,
  );
const candidate = git([
  'diff',
  '--raw',
  '-z',
  '--no-ext-diff',
  '--no-textconv',
  '--no-renames',
  baseRevision,
  'HEAD',
  '--',
  ...candidatePathspec,
]);
const candidateRevision = `sha256:${createHash('sha256').update(candidate).digest('hex')}`;
const untrackedCandidateFiles = git(['ls-files', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .trim()
  .split('\n')
  .filter((path) => path && !path.includes('/evidence/') && !path.includes('.evidence/'));
const evidenceDirectory = resolve(dirname(packet), `${basename(packet, '.md')}.evidence`);
const reports = {
  reviewer: join(evidenceDirectory, 'reviewer.json'),
  hardener: join(evidenceDirectory, 'hardener.json'),
  qa: join(evidenceDirectory, 'qa.json'),
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
const reviewerSchema = JSON.parse(
  await readFile(new URL('../spec/schemas/reviewer-report.schema.json', import.meta.url), 'utf8'),
);
const stageSchema = JSON.parse(
  await readFile(
    new URL('../spec/schemas/quality-stage-report.schema.json', import.meta.url),
    'utf8',
  ),
);
const validateReviewer = ajv.compile(reviewerSchema);
const validateStage = ajv.compile(stageSchema);
const failures = [];
if (
  process.env.PROMPTIRIS_REQUIRE_EXTERNAL_REVIEW === 'true' &&
  Number(process.env.PROMPTIRIS_EXTERNAL_REVIEW_COUNT ?? 0) < 1
) {
  failures.push('candidate has no authenticated approval from a reviewer other than the PR author');
}
if (untrackedCandidateFiles.length > 0) {
  failures.push(
    `candidate has untracked files outside evidence: ${untrackedCandidateFiles.join(', ')}`,
  );
}

const loadReport = async (role, path, validate) => {
  let report;
  try {
    report = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    failures.push(`${role} report is missing or unreadable: ${path}`);
    return null;
  }
  if (!validate(report)) failures.push(`${role} report violates its schema: ${path}`);
  if (report.taskId !== packet) failures.push(`${role} report taskId does not match ${packet}`);
  if (report.baseRevision !== baseRevision) failures.push(`${role} report has stale baseRevision`);
  if (report.candidateRevision !== candidateRevision)
    failures.push(`${role} report has stale candidateRevision`);
  for (const evidence of report.evidence ?? []) {
    if (isAbsolute(evidence.evidenceRef) || evidence.evidenceRef.split('/').includes('..')) {
      failures.push(`${role} evidence is not a repository-relative path: ${evidence.evidenceRef}`);
      continue;
    }
    const evidencePath = resolve(evidence.evidenceRef);
    const repositoryRoot = `${resolve('.')}/`;
    if (!evidencePath.startsWith(repositoryRoot)) {
      failures.push(`${role} evidence escapes the repository: ${evidence.evidenceRef}`);
      continue;
    }
    try {
      git(['ls-files', '--error-unmatch', '--', evidence.evidenceRef], {
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      const file = await open(evidencePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      let digest;
      try {
        if (!(await file.stat()).isFile()) throw new Error('evidence is not a regular file');
        digest = createHash('sha256')
          .update(await file.readFile())
          .digest('hex');
      } finally {
        await file.close();
      }
      if (digest !== evidence.evidenceSha256)
        failures.push(`${role} evidence digest mismatch: ${evidence.evidenceRef}`);
    } catch {
      failures.push(`${role} evidence is missing or unreadable: ${evidence.evidenceRef}`);
    }
  }
  return report;
};

const reviewer = await loadReport('reviewer', reports.reviewer, validateReviewer);
const hardener = await loadReport('hardener', reports.hardener, validateStage);
const qa = await loadReport('qa', reports.qa, validateStage);
const commonGitDirectory = git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  encoding: 'utf8',
}).trim();
const sharedRoot = commonGitDirectory.endsWith('/.git')
  ? commonGitDirectory.slice(0, -5)
  : resolve('.');
try {
  const claim = JSON.parse(
    await readFile(join(sharedRoot, '.agent', 'claims', `${branch}.json`), 'utf8'),
  );
  if (reviewer?.producerId === claim.agentId)
    failures.push('reviewer producer is the claimed Implementer');
} catch {
  // CI may not have the local lease; CODEOWNER review remains the external identity boundary.
}
if (reviewer && (reviewer.verdict !== 'pass' || reviewer.findings.length > 0))
  failures.push('reviewer has unresolved findings');
if (hardener && (hardener.role !== 'hardener' || hardener.status !== 'passed'))
  failures.push('hardener report is not passed');
if (qa && (qa.role !== 'qa' || qa.status !== 'passed' || qa.sourceBlind !== true))
  failures.push('QA report is not passed and source blind');
for (const [role, report] of Object.entries({ reviewer, hardener, qa })) {
  if (report?.evidence?.some((entry) => entry.status !== 'passed'))
    failures.push(`${role} report contains non-passing evidence`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.stderr.write(`Expected candidate revision: ${candidateRevision}\n`);
  process.exit(1);
}
process.stdout.write(`Role evidence passed for ${packet} at ${candidateRevision}.\n`);

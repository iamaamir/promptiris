#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareMutationPolicy,
  compareMutationTargets,
  compareForbiddenAdditions,
  inspectChangedSources,
  inspectCoverageThresholds,
  inspectMutationTargetRegistration,
  inspectPatchScope,
  parseMutationTargets,
} from '../tooling/quality/integrity-policy.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const optionalGit = (args) => {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};
const argument = process.argv.indexOf('--base');
const base =
  (argument >= 0 ? process.argv[argument + 1] : undefined) ??
  process.env.PROMPTIRIS_BASE_REVISION ??
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
const mergeBase = git(['merge-base', 'HEAD', base]);
const trustedMode = process.argv.includes('--trusted');
const trackedChanges = git(['diff', '--name-only', '--diff-filter=ACMRD', mergeBase])
  .split('\n')
  .filter(Boolean);
const untrackedChanges = git(['ls-files', '--others', '--exclude-standard'])
  .split('\n')
  .filter(Boolean);
const changedFiles = [...new Set([...trackedChanges, ...untrackedChanges])].sort();
const changes = git(['diff', '--name-status', '--no-renames', mergeBase])
  .split('\n')
  .filter(Boolean)
  .map((entry) => {
    const [status, path] = entry.split('\t');
    return { status, path };
  });
for (const path of untrackedChanges) changes.push({ status: 'A', path });
const addedLines = [];
let file = '';
let line = 0;
for (const entry of git(['diff', '--unified=0', mergeBase, '--', '*.ts', '*.mjs', '*.js']).split(
  '\n',
)) {
  if (entry.startsWith('+++ b/')) file = entry.slice(6);
  else if (entry.startsWith('@@')) line = Number(entry.match(/\+(\d+)/)?.[1] ?? 0);
  else if (entry.startsWith('+') && !entry.startsWith('+++')) {
    addedLines.push({ file, line, text: entry.slice(1) });
    line += 1;
  } else if (!entry.startsWith('-')) line += 1;
}
for (const path of untrackedChanges.filter((value) => /\.(?:ts|mjs|js)$/.test(value))) {
  const lines = (await readFile(path, 'utf8')).split('\n');
  lines.forEach((text, index) => addedLines.push({ file: path, line: index + 1, text }));
}

const mutationConfig = await readFile('stryker.config.mjs', 'utf8');
const previousMutationConfig = git(['show', `${mergeBase}:stryker.config.mjs`]);
const mutationPolicyChanged = changedFiles.includes('tooling/quality/mutation-policy.json');
const strykerConfigChanged = changedFiles.includes('stryker.config.mjs');
const previousMutationPolicy = mutationPolicyChanged
  ? JSON.parse(git(['show', `${mergeBase}:tooling/quality/mutation-policy.json`]))
  : undefined;
const mutationPolicy = mutationPolicyChanged
  ? JSON.parse(await readFile('tooling/quality/mutation-policy.json', 'utf8'))
  : undefined;
const mutationRegistration =
  mutationPolicyChanged || strykerConfigChanged
    ? inspectMutationTargetRegistration({
        beforeConfig: previousMutationConfig,
        afterConfig: mutationConfig,
        beforePolicy: previousMutationPolicy ?? {},
        afterPolicy: mutationPolicy ?? {},
        changedFiles,
      })
    : { safe: false, findings: [] };
const findings = inspectChangedSources({
  changedFiles,
  mutationTargets: parseMutationTargets(mutationConfig),
  addedLines,
});
findings.push(
  ...compareMutationTargets(
    parseMutationTargets(previousMutationConfig),
    parseMutationTargets(mutationConfig),
  ),
);
findings.push(...mutationRegistration.findings);
findings.push(...(await inspectCoverageThresholds(changedFiles.map((path) => resolve(path)))));

const branch =
  process.env.PROMPTIRIS_BRANCH ?? process.env.GITHUB_HEAD_REF ?? git(['branch', '--show-current']);
const packetPaths = optionalGit(['ls-tree', '-r', '--name-only', mergeBase, '.scratch'])
  .split('\n')
  .filter((path) => path.endsWith('.md'));
let packetSource = '';
let packetPath = '';
for (const path of packetPaths) {
  const source = optionalGit(['show', `${mergeBase}:${path}`]);
  if (source.includes(`Branch: \`${branch}\``)) {
    packetSource = source;
    packetPath = path;
    break;
  }
}
if (!packetSource && !trustedMode) {
  for (const path of changedFiles.filter(
    (value) => value.startsWith('.scratch/') && value.endsWith('.md'),
  )) {
    const source = await readFile(path, 'utf8');
    if (source.includes(`Branch: \`${branch}\``)) {
      packetSource = source;
      packetPath = path;
      process.stdout.write(`Bootstrap Work Item scope is candidate-local: ${path}\n`);
      break;
    }
  }
}
const packetList = (field) => {
  const lines = packetSource.split('\n');
  const start = lines.findIndex((line) => line === `${field}:`);
  if (start < 0) return [];
  const values = [];
  for (const line of lines.slice(start + 1)) {
    if (values.length === 0 && line === '') continue;
    const match = line.match(/^- `(.+)`$/);
    if (!match) break;
    values.push(match[1]);
  }
  return values;
};
const packetFlag = (field) => packetSource.split('\n').some((line) => line === `${field}: allowed`);
if (packetSource) {
  const allowedPaths = packetList('Allowed paths');
  if (allowedPaths.length === 0)
    process.stdout.write(`Legacy Work Item has no path firewall: ${packetPath}\n`);
  findings.push(
    ...inspectPatchScope({
      changes,
      allowedPaths,
      goldenChangesAllowed: packetFlag('Golden changes'),
      testDeletionAllowed: packetFlag('Test deletion'),
    }),
  );
} else {
  findings.push(
    trustedMode
      ? `trusted base has no Work Item scope for branch: ${branch}`
      : `feature branch has no Work Item scope: ${branch}`,
  );
}

if (mutationPolicyChanged) {
  findings.push(...compareMutationPolicy(previousMutationPolicy, mutationPolicy));
}
if (changedFiles.includes('tooling/quality/forbidden-additions.json')) {
  const previousSource = optionalGit([
    'show',
    `${mergeBase}:tooling/quality/forbidden-additions.json`,
  ]);
  const before = previousSource ? JSON.parse(previousSource) : { patterns: [] };
  const after = JSON.parse(await readFile('tooling/quality/forbidden-additions.json', 'utf8'));
  findings.push(...compareForbiddenAdditions(before, after));
}

const protectedFiles = changedFiles.filter(
  (path) =>
    path === 'eslint.config.js' ||
    (path === 'stryker.config.mjs' && !mutationRegistration.safe) ||
    path === 'tooling/vitest-config.ts' ||
    (path === 'tooling/quality/mutation-policy.json' && !mutationRegistration.safe) ||
    path === 'scripts/verify-candidate' ||
    path === 'scripts/quality-integrity.mjs' ||
    path === 'scripts/verify-role-evidence.mjs' ||
    path === 'scripts/tool-trace' ||
    path === 'scripts/redact-tool-output.mjs' ||
    path === 'scripts/agent-work' ||
    path === 'scripts/issue-sync' ||
    path === 'package.json' ||
    path === 'tsconfig.base.json' ||
    path === 'tooling/capabilities.json' ||
    path === 'tooling/quality/forbidden-additions.json' ||
    path === '.github/CODEOWNERS' ||
    path.startsWith('spec/schemas/') ||
    path.startsWith('.github/workflows/') ||
    path.startsWith('tooling/ast-grep/') ||
    path.startsWith('tooling/quality/integrity-'),
);

if (protectedFiles.length > 0) {
  process.stdout.write(
    `Protected verifier changes require CODEOWNER review:\n${protectedFiles.join('\n')}\n`,
  );
  if (trustedMode && Number(process.env.PROMPTIRIS_EXTERNAL_REVIEW_COUNT ?? 0) < 1) {
    findings.push(
      'protected verifier changes require approval from a reviewer other than the PR author',
    );
  }
}
if (findings.length > 0) {
  for (const finding of findings) process.stderr.write(`FAIL ${finding}\n`);
  process.exit(1);
}
process.stdout.write(`Integrity policy passed for ${changedFiles.length} changed files.\n`);

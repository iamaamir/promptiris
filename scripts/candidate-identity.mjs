import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';

const git = (root, args, options = {}) => execFileSync('git', args, { cwd: root, ...options });

export const implementationPathspec = (evidenceDirectory, root = resolve('.')) => [
  '.',
  `:(exclude)${relative(root, resolve(root, evidenceDirectory ?? '.'))}/**`,
];

export const candidateIdentity = (options = {}) => {
  const root = resolve(options.root ?? '.');
  const baseName =
    options.baseRevision ??
    process.env.PROMPTIRIS_BASE_REVISION ??
    (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : 'origin/main');
  const baseRevision = git(root, ['merge-base', 'HEAD', baseName], { encoding: 'utf8' }).trim();
  const candidate = git(root, [
    'diff',
    '--raw',
    '-z',
    '--no-ext-diff',
    '--no-textconv',
    '--no-renames',
    baseRevision,
    'HEAD',
    '--',
    ...implementationPathspec(options.evidenceDirectory, root),
  ]);
  return {
    baseRevision,
    candidateRevision: `sha256:${createHash('sha256').update(candidate).digest('hex')}`,
    headRevision: git(root, ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    branch: git(root, ['branch', '--show-current'], { encoding: 'utf8' }).trim(),
  };
};

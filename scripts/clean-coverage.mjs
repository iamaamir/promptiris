import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { workspaceDirectories } from '../tooling/quality/coverage-reports.mjs';

const root = resolve('.');
const targets = [
  join(root, 'coverage'),
  join(root, '.agent', 'reports', 'go-coverage.out'),
  join(root, '.agent', 'reports', 'crap.json'),
];
for (const workspace of await workspaceDirectories(root)) targets.push(join(workspace, 'coverage'));
for (const target of targets) await rm(target, { recursive: true, force: true });

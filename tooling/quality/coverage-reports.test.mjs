import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { discoverWorkspaceCoverage } from './coverage-reports.mjs';

test('discovers only canonical workspace coverage reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-prompt-coverage-'));
  const canonical = join(root, 'packages', 'core', 'coverage', 'coverage-final.json');
  const staleRoot = join(root, 'coverage', 'coverage-final.json');
  const staleNested = join(root, '.agent', 'work', 'coverage', 'coverage-final.json');
  for (const report of [canonical, staleRoot, staleNested]) {
    await mkdir(dirname(report), { recursive: true });
    await writeFile(report, '{}\n');
  }

  assert.deepEqual(await discoverWorkspaceCoverage(root), [canonical]);
});

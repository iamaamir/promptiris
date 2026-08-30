import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readRegularEvidenceFile } from './evidence-file.mjs';

test('CodeQL runs security-and-quality analysis and the project query pack', async () => {
  const workflow = await readFile('.github/workflows/codeql.yml', 'utf8');
  assert.match(workflow, /javascript-typescript/);
  assert.match(workflow, /language: go/);
  assert.match(workflow, /security-and-quality/);
  assert.match(workflow, /\.\/tooling\/codeql\/javascript/);
});

test('the project query governs every Node process-launch API', async () => {
  const query = await readFile('tooling/codeql/javascript/NativeProcessBoundary.ql', 'utf8');
  assert.match(query, /@id meta-prompt\/js\/native-process-boundary/);
  for (const member of ['exec', 'execFile', 'fork', 'spawn']) {
    assert.match(query, new RegExp(`"${member}"`));
  }
  assert.match(query, /apps\/runtime-node\/src\/native-plugin\.ts/);
});

test('role evidence rejects symlinks and platforms without no-follow file opens', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-evidence-file-'));
  const target = join(directory, 'target.txt');
  const link = join(directory, 'link.txt');
  await writeFile(target, 'trusted evidence');
  assert.equal((await readRegularEvidenceFile(target)).toString(), 'trusted evidence');
  await symlink(target, link);
  await assert.rejects(readRegularEvidenceFile(link));
  await assert.rejects(readRegularEvidenceFile(target, null));
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

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

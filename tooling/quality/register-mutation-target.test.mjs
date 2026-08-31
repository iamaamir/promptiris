import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const repositoryRoot = new URL('../..', import.meta.url);

test('registers one safe production mutation target and rejects unsafe repeats', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'promptiris-mutation-registration-'));
  try {
    await mkdir(join(workspace, 'scripts'), { recursive: true });
    await mkdir(join(workspace, 'tooling/quality'), { recursive: true });
    await mkdir(join(workspace, 'packages/demo/src'), { recursive: true });
    await writeFile(
      join(workspace, 'stryker.config.mjs'),
      "export default {\n  mutate: [\n    'packages/existing/src/source.ts',\n  ],\n  plugins: [],\n};\n",
    );
    await writeFile(
      join(workspace, 'tooling/quality/mutation-policy.json'),
      '{\n  "aggregate": { "minScore": 94, "maxIgnored": 0, "maxSurvived": 0, "maxNoCoverage": 0 },\n  "targets": {}\n}\n',
    );
    await writeFile(join(workspace, 'packages/demo/src/source.ts'), 'export {};\n');
    for (const path of [
      'scripts/register-mutation-target.mjs',
      'tooling/quality/integrity-policy.mjs',
      'tooling/quality/forbidden-additions.json',
    ]) {
      const destination = join(workspace, path);
      await writeFile(destination, await readFile(new URL(path, repositoryRoot)));
    }
    const run = (target) =>
      execFileSync(process.execPath, ['scripts/register-mutation-target.mjs', target], {
        cwd: workspace,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    assert.match(run('packages/demo/src/source.ts'), /Registered mutation target/);
    assert.match(
      await readFile(join(workspace, 'stryker.config.mjs'), 'utf8'),
      /'packages\/demo\/src\/source\.ts'/,
    );
    const policy = JSON.parse(
      await readFile(join(workspace, 'tooling/quality/mutation-policy.json'), 'utf8'),
    );
    assert.deepEqual(policy.targets['packages/demo/src/source.ts'], {
      minScore: 90,
      maxIgnored: 0,
      maxSurvived: 0,
      maxNoCoverage: 0,
    });
    assert.throws(() => run('packages/demo/src/source.ts'), /already registered/);
    assert.throws(() => run('README.md'), /repository-relative production TypeScript/);
  } finally {
    await rm(workspace, { recursive: true });
  }
});

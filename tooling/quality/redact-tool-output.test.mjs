import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('tool evidence redacts common credential shapes before persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-redaction-'));
  try {
    const input = join(directory, 'input.log');
    const output = join(directory, 'output.log');
    await writeFile(
      input,
      'Authorization: Bearer abc.def.ghi\napiKey="TOP_SECRET_VALUE"\nnpm_abcdefghijklmnop\nsafe output\n',
    );
    const count = Number(execFileSync('node', ['scripts/redact-tool-output.mjs', input, output]));
    const redacted = await readFile(output, 'utf8');
    assert.ok(count >= 3);
    assert.doesNotMatch(redacted, /abc\.def|TOP_SECRET|npm_abcdefghijklmnop/);
    assert.match(redacted, /safe output/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

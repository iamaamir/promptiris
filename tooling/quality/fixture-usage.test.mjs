import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { test } from 'node:test';

const manifest = JSON.parse(await readFile('spec/fixture-consumers.json', 'utf8'));

test('every shared fixture is exercised by a deterministic consumer', async () => {
  assert.equal(manifest.schemaVersion, 1);
  const actual = (await readdir('spec/fixtures')).map((name) => `spec/fixtures/${name}`).sort();
  const declared = manifest.fixtures.map(({ path }) => path).sort();
  assert.deepEqual(declared, actual);

  for (const fixture of manifest.fixtures) {
    assert.match(fixture.checkId, /^verify\.(?:integration|unit)$/);
    assert.ok(fixture.consumers.length > 0, `${fixture.path} has no consumer`);
    for (const consumer of fixture.consumers) {
      assert.match(consumer, /(?:\.test\.ts|_test\.go|^scripts\/)/);
      assert.match(await readFile(consumer, 'utf8'), new RegExp(basename(fixture.path)));
    }
  }
});

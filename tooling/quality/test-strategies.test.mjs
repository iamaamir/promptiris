import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Ajv2020 } from 'ajv/dist/2020.js';

const registry = JSON.parse(await readFile('tooling/quality/test-strategies.json', 'utf8'));
const schema = JSON.parse(await readFile('spec/schemas/test-strategies.schema.json', 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

test('test strategies are unique, classified, and evidence-bearing', () => {
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  const ids = registry.strategies.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(registry.strategies.some(({ id }) => id === 'state-model'));
  assert.ok(registry.strategies.some(({ id }) => id === 'deterministic-scheduling'));
  assert.ok(registry.strategies.some(({ gateMode }) => gateMode === 'capability-triggered'));
});

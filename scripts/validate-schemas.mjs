import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';

const allowedKeywords = new Set([
  '$defs',
  '$id',
  '$ref',
  '$schema',
  'additionalProperties',
  'const',
  'description',
  'enum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'oneOf',
  'pattern',
  'properties',
  'required',
  'title',
  'type',
]);
const schemaDirectory = resolve('spec/schemas');
const ajv = new Ajv2020({ strict: true, allErrors: true });

function inspectKeywords(value, path = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectKeywords(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (
      path !== '$.properties' &&
      !path.endsWith('.properties') &&
      !path.endsWith('.$defs') &&
      !allowedKeywords.has(key)
    ) {
      throw new Error(`${path}: keyword ${key} is outside the portable schema profile`);
    }
    inspectKeywords(child, `${path}.${key}`);
  }
}

const files = (await readdir(schemaDirectory)).filter((file) => file.endsWith('.json')).sort();
for (const file of files) {
  const schema = JSON.parse(await readFile(resolve(schemaDirectory, file), 'utf8'));
  inspectKeywords(schema);
  ajv.compile(schema);
}
console.log(`validated ${files.length} portable JSON Schemas`);

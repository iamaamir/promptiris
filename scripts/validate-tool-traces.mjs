import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';

const traceDirectory = resolve('.agent/traces');
const schema = JSON.parse(await readFile(resolve('spec/schemas/tool-trace.schema.json'), 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
let files = [];

try {
  files = (await readdir(traceDirectory)).filter((file) => file.endsWith('.json')).sort();
} catch {
  console.log('validated 0 schema-v2 Tool Traces; trace directory is absent');
  process.exit(0);
}

let checked = 0;
const failures = [];
for (const file of files) {
  const trace = JSON.parse(await readFile(resolve(traceDirectory, file), 'utf8'));
  if (trace.schemaVersion !== 2) continue;
  checked += 1;
  if (!validate(trace)) failures.push({ file, errors: validate.errors });
}

if (failures.length > 0) {
  console.error(JSON.stringify({ schemaVersion: 1, failures }, null, 2));
  process.exit(1);
}
console.log(
  `validated ${checked} schema-v2 Tool Traces; ${files.length - checked} legacy traces retained`,
);

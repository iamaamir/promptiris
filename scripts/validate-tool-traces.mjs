import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { repositoryLayout } from '../tooling/telemetry/analyze.mjs';

const root = resolve('.');
const layout = repositoryLayout(root);
const traceDirectories = [...new Set([layout.sharedRoot, ...layout.worktrees])].map((path) =>
  join(path, '.agent/traces'),
);
const schemaPaths = new Map([
  [2, 'spec/schemas/tool-trace.schema.json'],
  [3, 'spec/schemas/tool-trace-v3.schema.json'],
]);
const ajv = new Ajv2020({ strict: true, allErrors: true });
const validators = new Map(
  await Promise.all(
    [...schemaPaths].map(async ([version, path]) => [
      version,
      ajv.compile(JSON.parse(await readFile(resolve(path), 'utf8'))),
    ]),
  ),
);
const jsonFiles = async (directory) => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return (
      await Promise.all(
        entries.map((entry) => {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) return jsonFiles(path);
          return entry.isFile() && entry.name.endsWith('.json') ? [path] : [];
        }),
      )
    ).flat();
  } catch {
    return [];
  }
};
const files = (
  await Promise.all([
    ...traceDirectories.map((directory) => jsonFiles(directory)),
    jsonFiles(join(layout.sharedRoot, '.agent/imports')),
  ])
).flat();

let checked = 0;
const failures = [];
for (const file of files.sort()) {
  const trace = JSON.parse(await readFile(file, 'utf8'));
  const validate = validators.get(trace.schemaVersion);
  if (!validate) continue;
  checked += 1;
  if (!validate(trace)) failures.push({ file, errors: validate.errors });
}

if (failures.length > 0) {
  console.error(JSON.stringify({ schemaVersion: 1, failures }, null, 2));
  process.exit(1);
}
console.log(
  `validated ${checked} schema-v2/v3 Tool Traces; ${files.length - checked} unsupported historical traces excluded`,
);

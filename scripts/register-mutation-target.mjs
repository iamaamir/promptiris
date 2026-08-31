#!/usr/bin/env node
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseMutationTargets,
  productionSourcePattern,
} from '../tooling/quality/integrity-policy.mjs';

const [target] = process.argv.slice(2);
if (!target || process.argv.length !== 3)
  throw new Error('usage: scripts/register-mutation-target.mjs <production-typescript-path>');
if (!productionSourcePattern.test(target) || resolve(target) !== resolve(process.cwd(), target))
  throw new Error(`target must be a repository-relative production TypeScript path: ${target}`);
await access(target);

const mutationConfigPath = 'stryker.config.mjs';
const policyPath = 'tooling/quality/mutation-policy.json';
const [mutationConfig, policySource] = await Promise.all([
  readFile(mutationConfigPath, 'utf8'),
  readFile(policyPath, 'utf8'),
]);
const policy = JSON.parse(policySource);
if (parseMutationTargets(mutationConfig).has(target) || policy.targets?.[target])
  throw new Error(`mutation target is already registered: ${target}`);
const marker = '  ],\n  plugins:';
if (!mutationConfig.includes(marker)) throw new Error('unrecognized Stryker mutate configuration');
const nextMutationConfig = mutationConfig.replace(marker, `    '${target}',\n${marker}`);
const nextPolicy = {
  ...policy,
  targets: {
    ...policy.targets,
    [target]: { minScore: 90, maxIgnored: 0, maxSurvived: 0, maxNoCoverage: 0 },
  },
};

const writeAtomically = async (path, contents) => {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents);
  await rename(temporary, path);
};
await Promise.all([
  writeAtomically(mutationConfigPath, nextMutationConfig),
  writeAtomically(policyPath, `${JSON.stringify(nextPolicy, null, 2)}\n`),
]);
process.stdout.write(`Registered mutation target: ${target}\n`);

import { readFile } from 'node:fs/promises';

const forbiddenAdditions = JSON.parse(
  await readFile(new URL('./forbidden-additions.json', import.meta.url), 'utf8'),
);
const suppressionPattern = new RegExp(forbiddenAdditions.patterns.join('|'), 'i');
const productionSourcePattern = /^(?:packages\/[^/]+|apps\/runtime-node)\/src\/.+\.ts$/;

const compareCeiling = (findings, path, before, after) => {
  if (typeof before === 'number' && typeof after === 'number' && after > before) {
    findings.push(`${path} increased from ${before} to ${after}`);
  }
};

const compareFloor = (findings, path, before, after) => {
  if (typeof before === 'number' && typeof after === 'number' && after < before) {
    findings.push(`${path} decreased from ${before} to ${after}`);
  }
};

export const compareMutationPolicy = (before, after) => {
  const findings = [];
  compareFloor(
    findings,
    'aggregate.minScore',
    before.aggregate?.minScore,
    after.aggregate?.minScore,
  );
  for (const key of ['maxIgnored', 'maxSurvived', 'maxNoCoverage']) {
    compareCeiling(findings, `aggregate.${key}`, before.aggregate?.[key], after.aggregate?.[key]);
  }
  for (const [file, baseline] of Object.entries(before.targets ?? {})) {
    const candidate = after.targets?.[file];
    if (!candidate) {
      findings.push(`mutation target removed from policy: ${file}`);
      continue;
    }
    compareFloor(findings, `${file}.minScore`, baseline.minScore, candidate.minScore);
    for (const key of ['maxIgnored', 'maxSurvived', 'maxNoCoverage']) {
      compareCeiling(findings, `${file}.${key}`, baseline[key], candidate[key]);
    }
  }
  for (const [file, baseline] of Object.entries(after.targets ?? {})) {
    if (before.targets?.[file]) continue;
    if ((baseline.minScore ?? 0) < 90) findings.push(`new target below 90 percent: ${file}`);
    if ((baseline.maxIgnored ?? 0) > 0)
      findings.push(`new target starts with ignored mutants: ${file}`);
  }
  return findings;
};

export const compareForbiddenAdditions = (before, after) =>
  before.patterns
    .filter((pattern) => !after.patterns.includes(pattern))
    .map((pattern) => `forbidden-addition rule removed: ${pattern}`);

export const parseMutationTargets = (source) => {
  const block = source.match(/mutate\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? '';
  return new Set([...block.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]));
};

export const compareMutationTargets = (before, after) =>
  [...before]
    .filter((target) => !after.has(target))
    .map((target) => `mutation target removed from Stryker configuration: ${target}`);

const pathPattern = (pattern) => {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${escaped.replaceAll('**', '\u0000').replaceAll('*', '[^/]*').replaceAll('\u0000', '.*')}$`,
  );
};

const isTestFile = (path) => /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
const isGolden = (path) =>
  path.endsWith('.snap') || /(?:^|\/)(?:__snapshots__|goldens?)(?:\/|$)/.test(path);

export const inspectPatchScope = ({
  changes,
  allowedPaths,
  goldenChangesAllowed = false,
  testDeletionAllowed = false,
}) => {
  const findings = [];
  const matchers = allowedPaths.map(pathPattern);
  for (const { status, path } of changes) {
    if (matchers.length > 0 && !matchers.some((matcher) => matcher.test(path))) {
      findings.push(`changed path is outside Work Item scope: ${path}`);
    }
    if (status === 'D' && isTestFile(path) && !testDeletionAllowed) {
      findings.push(`test deletion is not authorized by the Work Item: ${path}`);
    }
    if ((status === 'M' || status === 'D') && isGolden(path) && !goldenChangesAllowed) {
      findings.push(`golden artifact change is not authorized by the Work Item: ${path}`);
    }
  }
  return findings;
};

export const inspectChangedSources = ({ changedFiles, mutationTargets, addedLines }) => {
  const findings = [];
  for (const file of changedFiles) {
    if (
      productionSourcePattern.test(file) &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.d.ts') &&
      !mutationTargets.has(file)
    ) {
      findings.push(`changed production source is not mutation governed: ${file}`);
    }
  }
  for (const line of addedLines) {
    if (suppressionPattern.test(line.text)) {
      findings.push(`new suppression or skipped test at ${line.file}:${line.line}`);
    }
  }
  return findings;
};

export const inspectCoverageThresholds = async (files) => {
  const findings = [];
  for (const file of files.filter((path) => path.endsWith('vitest.config.ts'))) {
    const source = await readFile(file, 'utf8');
    const calls = [...source.matchAll(/createVitestConfig\(([^)]*)\)/g)];
    if (calls.length === 0) {
      findings.push(`coverage config does not use the governed factory: ${file}`);
      continue;
    }
    for (const call of calls) {
      const match = call[1]?.trim().match(/^(\d+(?:\.\d+)?)$/);
      if (!match) {
        findings.push(`coverage threshold is not a reviewable numeric literal: ${file}`);
        continue;
      }
      const threshold = Number(match[1]);
      if (threshold < 90)
        findings.push(`coverage threshold below 90 percent: ${file} (${threshold})`);
    }
  }
  return findings;
};

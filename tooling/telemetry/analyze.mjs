import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { discoverWorkspaceCoverage } from '../quality/coverage-reports.mjs';
import { mutationSummary } from '../quality/mutation-report.mjs';

const safeJson = async (path, fallback = null) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
};

const readJsonDirectory = async (directory) => {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => safeJson(join(directory, entry.name))),
    );
  } catch {
    return [];
  }
};

const normalizeTrace = (trace) => {
  if (trace?.schemaVersion === 2) {
    return {
      schemaVersion: 2,
      traceId: trace.traceId,
      runId: trace.runId,
      taskId: trace.taskId,
      providerId: trace.providerId,
      tools: trace.tools ?? [],
      executor: trace.executor,
      startedAtEpochMs: trace.startedAtEpochMs,
      durationMs: trace.durationMs,
      exitCode: trace.exitCode,
      rawBytes: trace.output?.rawBytes ?? 0,
      modelVisibleBytes: trace.output?.modelVisibleBytes ?? null,
      reducedBytes: trace.output?.reducedBytes ?? null,
      estimatedRawTokens: trace.output?.estimatedRawTokens ?? null,
      estimatedModelVisibleTokens: trace.output?.estimatedModelVisibleTokens ?? null,
      estimatedTokensAvoided: trace.output?.estimatedTokensAvoided ?? null,
      evidenceRef: trace.evidence?.ref ?? null,
    };
  }
  return {
    schemaVersion: 1,
    traceId: trace?.traceId ?? 'unknown',
    runId: 'legacy',
    taskId: trace?.taskId ?? 'unscoped',
    providerId: `legacy:${trace?.command ?? 'unknown'}`,
    tools: [],
    executor: trace?.command ?? 'unknown',
    startedAtEpochMs: trace?.startedAtEpochMs ?? 0,
    durationMs: trace?.durationMs ?? 0,
    exitCode: trace?.exitCode ?? 1,
    rawBytes: trace?.rawOutputBytes ?? 0,
    modelVisibleBytes: null,
    reducedBytes: null,
    estimatedRawTokens: null,
    estimatedModelVisibleTokens: null,
    estimatedTokensAvoided: null,
    evidenceRef: trace?.rawEvidenceRef ?? null,
  };
};

const sum = (items, field) => items.reduce((total, item) => total + (item[field] ?? 0), 0);
const round = (value, digits = 1) => Number(value.toFixed(digits));
const percentile = (values, fraction) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};

const aggregate = (items, identity) => {
  const groups = new Map();
  for (const item of items) {
    const id = identity(item);
    const current = groups.get(id) ?? [];
    current.push(item);
    groups.set(id, current);
  }
  return [...groups.entries()]
    .map(([id, group]) => {
      const exact = group.filter((item) => item.modelVisibleBytes !== null);
      const durationValues = group.map((item) => item.durationMs);
      return {
        id,
        calls: group.length,
        failures: group.filter((item) => item.exitCode !== 0).length,
        durationMs: sum(group, 'durationMs'),
        p50DurationMs: percentile(durationValues, 0.5),
        p95DurationMs: percentile(durationValues, 0.95),
        rawBytes: sum(group, 'rawBytes'),
        modelVisibleBytes: sum(exact, 'modelVisibleBytes'),
        reducedBytes: sum(exact, 'reducedBytes'),
        estimatedTokensAvoided: sum(exact, 'estimatedTokensAvoided'),
        exactReductionCalls: exact.length,
      };
    })
    .sort((left, right) => right.calls - left.calls || right.durationMs - left.durationMs);
};

const summarizeTraces = (traces) => {
  const exact = traces.filter((trace) => trace.modelVisibleBytes !== null);
  return {
    traceCount: traces.length,
    failedTraceCount: traces.filter((trace) => trace.exitCode !== 0).length,
    durationMs: sum(traces, 'durationMs'),
    rawBytes: sum(traces, 'rawBytes'),
    modelVisibleBytes: sum(exact, 'modelVisibleBytes'),
    reducedBytes: sum(exact, 'reducedBytes'),
    estimatedRawTokens: sum(exact, 'estimatedRawTokens'),
    estimatedModelVisibleTokens: sum(exact, 'estimatedModelVisibleTokens'),
    estimatedTokensAvoided: sum(exact, 'estimatedTokensAvoided'),
    exactReductionTraceCount: exact.length,
    outputReductionPercent:
      sum(exact, 'rawBytes') === 0
        ? 0
        : round((sum(exact, 'reducedBytes') / sum(exact, 'rawBytes')) * 100),
  };
};

const parseVerificationRuns = async (path) => {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  } catch {
    return [];
  }
};

const counterSummary = (coverage, key) => {
  const values = Object.values(coverage)
    .flatMap((entry) => Object.values(entry[key] ?? {}))
    .flat(Infinity);
  const total = values.length;
  const covered = values.filter((value) => value > 0).length;
  return { covered, total, percent: total === 0 ? 100 : round((covered / total) * 100, 2) };
};

const coverageSummary = async (root) => {
  const paths = await discoverWorkspaceCoverage(root);
  const reports = (await Promise.all(paths.map((path) => safeJson(path, {})))).filter(Boolean);
  const merged = Object.assign({}, ...reports);
  return {
    reportCount: reports.length,
    reports: paths.map((path) => relative(root, path)),
    statements: counterSummary(merged, 's'),
    functions: counterSummary(merged, 'f'),
    branches: counterSummary(merged, 'b'),
  };
};

const goCoverageSummary = async (path) => {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').slice(1).filter(Boolean);
    const blocks = lines.map((line) => {
      const [location, statements, count] = line.trim().split(/\s+/);
      return { location, statements: Number(statements), count: Number(count) };
    });
    const total = blocks.reduce((sum, block) => sum + block.statements, 0);
    const covered = blocks
      .filter((block) => block.count > 0)
      .reduce((sum, block) => sum + block.statements, 0);
    return {
      available: true,
      covered,
      total,
      percent: total === 0 ? 100 : round((covered / total) * 100, 2),
      targetPercent: 80,
      meetsTarget: total > 0 && (covered / total) * 100 >= 80,
      report: '.agent/reports/go-coverage.out',
    };
  } catch {
    return { available: false, targetPercent: 80 };
  }
};

const crapSummary = (report) => {
  if (!report?.functions) return { available: false };
  const maximum = [...report.functions].sort((left, right) => right.crap - left.crap)[0] ?? null;
  return {
    available: true,
    functionCount: report.functions.length,
    violationCount: report.violations?.length ?? 0,
    maximum,
    thresholds: report.thresholds ?? { protocolAndCore: 15, default: 30 },
    measuredAt: report.measuredAt ?? null,
  };
};

const benchmarkSummary = (report) => {
  const result = report?.results?.[0];
  if (!result) return { available: false };
  return {
    available: true,
    command: result.command,
    meanMs: round(result.mean * 1000, 2),
    medianMs: round(result.median * 1000, 2),
    minMs: round(result.min * 1000, 2),
    maxMs: round(result.max * 1000, 2),
  };
};

const toolRows = (traces) => {
  const expanded = traces.flatMap((trace) => trace.tools.map((tool) => ({ ...trace, tool })));
  return aggregate(expanded, (trace) => trace.tool);
};

const capabilityRows = (registry, observedTools) =>
  Object.entries(registry?.capabilities ?? {}).map(([id, capability]) => {
    const providers = capability.providers ?? [];
    const calls = providers.reduce(
      (total, provider) => total + (observedTools.get(provider) ?? 0),
      0,
    );
    return {
      id,
      providers,
      calls,
      utilization: calls === 0 ? 'unobserved' : calls < 3 ? 'low' : 'active',
      costClass: capability.costClass,
      contextClass: capability.contextClass,
    };
  });

const automationCandidates = (traces) =>
  aggregate(traces, (trace) => `${trace.taskId} · ${trace.providerId}`)
    .filter((row) => row.calls >= 3)
    .map((row) => ({
      ...row,
      priority: row.calls >= 10 || row.durationMs >= 30_000 ? 'high' : 'review',
      recommendation: `Promote ${row.id} when its invocation and failure-reduction steps are stable.`,
    }));

const deriveInsights = ({ summary, providers, tools, capabilities, quality }) => {
  const insights = [];
  const mostUsed = tools[0] ?? providers[0];
  const exactProviders = providers.filter((provider) => !provider.id.startsWith('legacy:'));
  const slowest = [...(exactProviders.length > 0 ? exactProviders : providers)].sort(
    (left, right) => right.durationMs - left.durationMs,
  )[0];
  const unused = capabilities.filter((capability) => capability.utilization === 'unobserved');
  if (mostUsed)
    insights.push({
      kind: 'usage',
      title: `${mostUsed.id} is most used`,
      detail: `${mostUsed.calls} measured calls.`,
    });
  if (slowest)
    insights.push({
      kind: 'cost',
      title: `${slowest.id} consumes the most verifier time`,
      detail: `${round(slowest.durationMs / 1000, 2)} seconds across ${slowest.calls} calls.`,
    });
  if (unused.length > 0)
    insights.push({
      kind: 'opportunity',
      title: `${unused.length} registered capabilities are unobserved`,
      detail: unused.map((item) => item.id).join(', '),
    });
  if (summary.exactReductionTraceCount > 0)
    insights.push({
      kind: 'context',
      title: `${summary.outputReductionPercent}% of measured command output stayed outside model context`,
      detail: `${summary.estimatedTokensAvoided} tokens avoided by the declared UTF-8 byte estimate.`,
    });
  if (quality.goCoverage.available && !quality.goCoverage.meetsTarget)
    insights.push({
      kind: 'quality-gap',
      title: `Go coverage is ${quality.goCoverage.percent}% against an ${quality.goCoverage.targetPercent}% target`,
      detail: `${quality.goCoverage.total - quality.goCoverage.covered} weighted statements remain uncovered.`,
    });
  if (!quality.crap.available)
    insights.push({
      kind: 'data-gap',
      title: 'CRAP evidence is missing',
      detail: 'Run pnpm test:coverage and pnpm quality:crap.',
    });
  return insights;
};

export const analyzeTelemetry = async (options = {}) => {
  const root = resolve(options.root ?? '.');
  const rawTraces = (await readJsonDirectory(join(root, '.agent/traces'))).filter(Boolean);
  const traces = rawTraces.map(normalizeTrace);
  const capabilitiesRegistry = await safeJson(join(root, 'tooling/capabilities.json'), {
    capabilities: {},
  });
  const providers = aggregate(traces, (trace) => trace.providerId);
  const tools = toolRows(traces);
  const summary = summarizeTraces(traces);
  const observedTools = new Map(tools.map((tool) => [tool.id, tool.calls]));
  observedTools.set('scripts/tool-trace', summary.exactReductionTraceCount);
  const capabilities = capabilityRows(capabilitiesRegistry, observedTools);
  const mutationReport = await safeJson(join(root, '.agent/reports/mutation.json'));
  const mutationPolicy = await safeJson(join(root, 'tooling/quality/mutation-policy.json'));
  const quality = {
    mutation: mutationSummary(mutationReport, mutationPolicy),
    coverage: await coverageSummary(root),
    goCoverage: await goCoverageSummary(join(root, '.agent/reports/go-coverage.out')),
    crap: crapSummary(await safeJson(join(root, '.agent/reports/crap.json'))),
    agentContextBenchmark: benchmarkSummary(
      await safeJson(join(root, '.agent/reports/agent-context-benchmark.json')),
    ),
  };
  const verificationRunRecords = await parseVerificationRuns(
    join(root, '.agent/reports/verification-runs.jsonl'),
  );
  const verificationRuns = verificationRunRecords.map((run) => ({
    ...run,
    telemetry: summarizeTraces(traces.filter((trace) => trace.runId === run.runId)),
  }));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: { ...summary, latestVerification: verificationRuns[0] ?? null },
    dataQuality: {
      legacyTraceCount: traces.filter((trace) => trace.schemaVersion === 1).length,
      exactTraceCount: traces.filter((trace) => trace.schemaVersion === 2).length,
      tokenValuesAreEstimates: true,
      tokenEstimateMethod: 'ceil(UTF-8 output bytes / 4)',
      observationScope:
        'Commands executed through scripts/tool-trace; interactive shell and model calls are not intercepted.',
    },
    usage: {
      providers,
      tools,
      tasks: aggregate(traces, (trace) => trace.taskId),
      capabilities,
    },
    quality,
    verificationRuns: verificationRuns.slice(0, 30),
    automationCandidates: automationCandidates(traces).slice(0, 30),
    insights: [],
    sources: [
      '.agent/traces/*.json',
      '.agent/reports/verification-runs.jsonl',
      '.agent/reports/mutation.json',
      '.agent/reports/crap.json',
      '**/coverage/coverage-final.json',
      '.agent/reports/go-coverage.out',
      '.agent/reports/agent-context-benchmark.json',
      'tooling/capabilities.json',
      'tooling/quality/mutation-policy.json',
    ],
  };
  report.insights = deriveInsights({ summary, providers, tools, capabilities, quality });
  return report;
};

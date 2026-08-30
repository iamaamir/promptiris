const byId = (id) => document.getElementById(id);
const text = (tag, value, className) => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};
const formatDuration = (milliseconds) =>
  milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
const formatNumber = (value) => new Intl.NumberFormat().format(value ?? 0);
const formatObservedAt = (epoch) => (epoch === null ? 'Never' : new Date(epoch).toLocaleString());

const replaceChildren = (id, children) => byId(id).replaceChildren(...children);
const state = (value) => text('span', value, `state state--${String(value).toLowerCase()}`);

const renderSummary = (report) => {
  const latestVerification = report.summary.latestVerification;
  const verificationState =
    latestVerification === undefined || latestVerification === null
      ? 'No run'
      : latestVerification.validatesCurrentHead
        ? latestVerification.status
        : 'stale';
  const items = [
    ['Current-head verification', verificationState],
    ['Tool traces', formatNumber(report.summary.traceCount)],
    ['Observed worktrees', formatNumber(report.dataQuality.worktreeCount)],
    ['Attributed agents', formatNumber(report.dataQuality.agentCount)],
    ['Unattributed traces', formatNumber(report.dataQuality.unattributedTraceCount)],
    ['Redactions applied', formatNumber(report.dataQuality.recordedRedactionCount)],
    ['Pre-redaction traces', formatNumber(report.dataQuality.preRedactionTraceCount)],
    ['Verifier time', formatDuration(report.summary.durationMs)],
    ['Raw output', formatBytes(report.summary.rawBytes)],
    ['Context avoided', formatBytes(report.summary.reducedBytes)],
    ['Estimated tokens avoided', formatNumber(report.summary.estimatedTokensAvoided)],
  ];
  replaceChildren(
    'summary',
    items.map(([label, value]) => {
      const group = document.createElement('div');
      group.append(text('dt', label), text('dd', value));
      return group;
    }),
  );
};

const renderInsights = (insights) =>
  replaceChildren(
    'insights',
    insights.map((insight) => {
      const item = document.createElement('li');
      item.append(text('strong', insight.title), text('span', insight.detail));
      return item;
    }),
  );

const row = (cells) => {
  const item = document.createElement('tr');
  for (const cell of cells) {
    const node = document.createElement('td');
    node.append(cell instanceof Node ? cell : document.createTextNode(String(cell)));
    item.append(node);
  }
  return item;
};

const renderRuns = (runs) =>
  replaceChildren(
    'runs',
    runs.length > 0
      ? runs.map((run) =>
          row([
            run.runId,
            run.profile,
            state(run.status),
            formatDuration(run.durationMs ?? 0),
            formatBytes(run.telemetry?.rawBytes ?? 0),
            formatBytes(run.telemetry?.reducedBytes ?? 0),
            formatNumber(run.failedGateCount),
          ]),
        )
      : [row(['No verification runs recorded', '—', state('unused'), '—', '—', '—', '—'])],
  );

const qualityItem = (title, value, detail) => {
  const article = document.createElement('article');
  article.className = 'quality-item';
  article.append(text('h3', title), text('p', value, 'quality-value'), text('p', detail));
  return article;
};

const signed = (value, suffix = '') => `${value > 0 ? '+' : ''}${value}${suffix}`;

const renderMutationTargets = (mutation) =>
  replaceChildren(
    'mutation-targets',
    mutation.available
      ? mutation.targets.map((target) =>
          row([
            target.file,
            `${target.score}%`,
            formatNumber(target.survived),
            formatNumber(target.noCoverage),
            formatNumber(target.ignored),
            target.deltas
              ? `${signed(target.deltas.score, 'pp')} · ${signed(
                  target.deltas.survived + target.deltas.noCoverage,
                )} unresolved · ${signed(target.deltas.ignored)} ignored`
              : 'No baseline',
            state(target.status),
          ]),
        )
      : [row(['No mutation report', '—', '—', '—', '—', '—', state('unobserved')])],
  );

const renderQuality = (quality) => {
  const mutation = quality.mutation;
  const coverage = quality.coverage;
  const goCoverage = quality.goCoverage;
  const crap = quality.crap;
  const benchmark = quality.agentContextBenchmark;
  const roles = quality.roles;
  const evidenceState = (provenance) => provenance?.state ?? 'unbound';
  replaceChildren('quality-grid', [
    qualityItem(
      'Mutation',
      mutation.available ? `${mutation.score}%` : 'Missing',
      mutation.available
        ? `${mutation.policy.status}; ${mutation.debt.unresolved} unresolved; ${mutation.debt.ignored} ignored; evidence ${evidenceState(mutation.provenance)}`
        : 'Run the full verifier',
    ),
    qualityItem(
      'TypeScript coverage',
      `${coverage.statements.percent}%`,
      `${coverage.statements.covered}/${coverage.statements.total} statements; ${coverage.functions.covered}/${coverage.functions.total} functions; evidence ${evidenceState(quality.coverageProvenance)}`,
    ),
    qualityItem(
      'Go coverage',
      goCoverage.available ? `${goCoverage.percent}%` : 'Missing',
      goCoverage.available
        ? `${goCoverage.covered} / ${goCoverage.total} statements; target ${goCoverage.targetPercent}%`
        : 'Run the full verifier',
    ),
    qualityItem(
      'CRAP',
      crap.available ? `${crap.violationCount} violations` : 'Missing',
      crap.available
        ? `Maximum ${crap.maximum?.crap ?? 0} at ${crap.maximum?.file ?? 'none'}; evidence ${evidenceState(crap.provenance)}`
        : 'Run coverage, then CRAP analysis',
    ),
    qualityItem(
      'Agent context',
      benchmark.available ? `${benchmark.meanMs} ms` : 'Missing',
      benchmark.available
        ? `Range ${benchmark.minMs}–${benchmark.maxMs} ms; evidence ${evidenceState(benchmark.provenance)}`
        : 'Run the context benchmark',
    ),
    qualityItem(
      'Role evidence',
      `${roles.passedCount}/${roles.reportCount} passed`,
      roles.reportCount === 0
        ? 'Reviewer, Hardener, and source-blind QA reports are missing'
        : `${roles.failedCount} non-passing reports remain`,
    ),
  ]);
  renderMutationTargets(mutation);
};

const renderTools = (usage) => {
  replaceChildren(
    'tool-rows',
    usage.inventory.length > 0
      ? usage.inventory.map((tool) =>
          row([
            tool.name,
            tool.group,
            tool.capabilities.join(', '),
            tool.executionRoles.join(', ') || 'unclassified',
            state(tool.state),
            formatNumber(tool.calls),
            formatNumber(tool.failures),
            formatObservedAt(tool.lastObservedAtEpochMs),
            tool.requiredIn.join(', ') || 'optional',
          ]),
        )
      : [
          row([
            'No registered providers',
            '—',
            '—',
            '—',
            state('unobserved'),
            '0',
            '0',
            'Never',
            '—',
          ]),
        ],
  );
  replaceChildren(
    'capability-rows',
    usage.capabilities.map((capability) =>
      row([
        capability.id,
        capability.providers.join(', '),
        capability.executionRole,
        formatNumber(capability.calls),
        state(capability.utilization),
        capability.costClass,
      ]),
    ),
  );
  replaceChildren(
    'agent-rows',
    usage.agents.map((agent) =>
      row([
        agent.id,
        agent.branches.join(', ') || 'historical',
        formatNumber(agent.calls),
        formatNumber(agent.failures),
        formatNumber(agent.dirtyCalls),
        formatDuration(agent.durationMs),
        formatObservedAt(agent.lastObservedAtEpochMs),
      ]),
    ),
  );
};

const renderAutomation = (candidates) =>
  replaceChildren(
    'automation-rows',
    candidates.length > 0
      ? candidates.map((candidate) =>
          row([
            candidate.id,
            formatNumber(candidate.calls),
            formatDuration(candidate.durationMs),
            formatBytes(candidate.rawBytes),
            state(candidate.priority),
          ]),
        )
      : [row(['No repeated patterns meet the threshold', '0', '0 ms', '0 B', state('active')])],
  );

const renderProvenance = (report) => {
  const quality = report.dataQuality;
  const entries = [
    ['Current Tool Traces', formatNumber(quality.exactTraceCount)],
    ['Observed worktrees', formatNumber(quality.worktreeCount)],
    ['Attributed agents', formatNumber(quality.agentCount)],
    ['Unattributed traces', formatNumber(quality.unattributedTraceCount)],
    ['Token values', quality.tokenValuesAreEstimates ? 'Estimated' : 'Measured'],
    ['Estimate method', quality.tokenEstimateMethod],
    ['Observation scope', quality.observationScope],
  ];
  replaceChildren(
    'data-quality',
    entries.flatMap(([term, description]) => [text('dt', term), text('dd', description)]),
  );
  replaceChildren(
    'sources',
    report.sources.map((source) => text('li', source)),
  );
};

const render = (report) => {
  renderSummary(report);
  renderInsights(report.insights);
  renderRuns(report.verificationRuns);
  renderQuality(report.quality);
  renderTools(report.usage);
  renderAutomation(report.automationCandidates);
  renderProvenance(report);
  byId('freshness').textContent = `Generated ${new Date(report.generatedAt).toLocaleString()}`;
};

const load = async () => {
  const button = byId('refresh');
  button.disabled = true;
  byId('status').textContent = 'Refreshing local evidence.';
  try {
    const response = await fetch('/api/telemetry', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    byId('status').textContent = 'Evidence is current.';
  } catch (error) {
    byId('status').textContent =
      `Evidence unavailable: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
  }
};

byId('refresh').addEventListener('click', load);
await load();

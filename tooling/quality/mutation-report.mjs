const detectedStatuses = new Set(['Killed', 'Timeout', 'RuntimeError']);
const excludedStatuses = new Set(['Ignored', 'CompileError']);

const round = (value, digits = 2) => Number(value.toFixed(digits));
const countStatus = (mutants, status) =>
  mutants.filter((mutant) => mutant.status === status).length;

const targetSummary = (file, mutants, baseline) => {
  const assessed = mutants.filter((mutant) => !excludedStatuses.has(mutant.status));
  const detected = assessed.filter((mutant) => detectedStatuses.has(mutant.status));
  const survived = countStatus(mutants, 'Survived');
  const noCoverage = countStatus(mutants, 'NoCoverage');
  const ignored = countStatus(mutants, 'Ignored');
  const score = assessed.length === 0 ? 100 : round((detected.length / assessed.length) * 100);
  const debt = survived + noCoverage;
  const deltas = baseline
    ? {
        score: round(score - baseline.minScore),
        ignored: ignored - baseline.maxIgnored,
        survived: survived - baseline.maxSurvived,
        noCoverage: noCoverage - baseline.maxNoCoverage,
      }
    : null;
  const regressions = baseline
    ? [
        score < baseline.minScore ? `score ${score}% is below ${baseline.minScore}%` : null,
        ignored > baseline.maxIgnored ? `ignored ${ignored} exceeds ${baseline.maxIgnored}` : null,
        survived > baseline.maxSurvived
          ? `survived ${survived} exceeds ${baseline.maxSurvived}`
          : null,
        noCoverage > baseline.maxNoCoverage
          ? `uncovered ${noCoverage} exceeds ${baseline.maxNoCoverage}`
          : null,
      ].filter(Boolean)
    : ['target has no mutation policy baseline'];
  return {
    file,
    score,
    assessed: assessed.length,
    detected: detected.length,
    ignored,
    survived,
    noCoverage,
    debt,
    baseline: baseline ?? null,
    deltas,
    status: regressions.length === 0 ? 'stable' : 'regressed',
    regressions,
  };
};

const ageInDays = (date, now) => {
  const started = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(started)) return null;
  return Math.max(0, Math.floor((now.getTime() - started) / 86_400_000));
};

export const mutationSummary = (report, policy, now = new Date()) => {
  if (!report?.files) return { available: false };
  const targets = Object.entries(report.files)
    .map(([file, value]) => targetSummary(file, value.mutants ?? [], policy?.targets?.[file]))
    .sort((left, right) => right.debt - left.debt || left.file.localeCompare(right.file));
  const mutants = Object.values(report.files).flatMap((file) => file.mutants ?? []);
  const statuses = Object.fromEntries(
    [...new Set(mutants.map((mutant) => mutant.status))]
      .sort()
      .map((status) => [status, countStatus(mutants, status)]),
  );
  const assessed = mutants.filter((mutant) => !excludedStatuses.has(mutant.status));
  const detected = assessed.filter((mutant) => detectedStatuses.has(mutant.status));
  const score = assessed.length === 0 ? 100 : round((detected.length / assessed.length) * 100);
  const aggregateRegressions = policy
    ? [
        score < policy.aggregate.minScore
          ? `aggregate score ${score}% is below ${policy.aggregate.minScore}%`
          : null,
        (statuses.Ignored ?? 0) > policy.aggregate.maxIgnored
          ? `aggregate ignored ${statuses.Ignored ?? 0} exceeds ${policy.aggregate.maxIgnored}`
          : null,
        (statuses.Survived ?? 0) > policy.aggregate.maxSurvived
          ? `aggregate survived ${statuses.Survived ?? 0} exceeds ${policy.aggregate.maxSurvived}`
          : null,
        (statuses.NoCoverage ?? 0) > policy.aggregate.maxNoCoverage
          ? `aggregate uncovered ${statuses.NoCoverage ?? 0} exceeds ${policy.aggregate.maxNoCoverage}`
          : null,
      ].filter(Boolean)
    : ['mutation policy is missing'];
  const observedTargets = new Set(targets.map((target) => target.file));
  const missingTargets = Object.keys(policy?.targets ?? {})
    .filter((file) => !observedTargets.has(file))
    .map((file) => `policy target is missing from mutation report: ${file}`);
  const regressions = [
    ...aggregateRegressions,
    ...missingTargets,
    ...targets.flatMap((target) =>
      target.regressions.map((regression) => `${target.file}: ${regression}`),
    ),
  ];
  return {
    available: true,
    score,
    total: mutants.length,
    assessed: assessed.length,
    statuses,
    thresholds: report.thresholds,
    targets,
    debt: {
      ignored: statuses.Ignored ?? 0,
      survived: statuses.Survived ?? 0,
      noCoverage: statuses.NoCoverage ?? 0,
      unresolved: (statuses.Survived ?? 0) + (statuses.NoCoverage ?? 0),
      baselineDate: policy?.baselineDate ?? null,
      ageDays: policy?.baselineDate ? ageInDays(policy.baselineDate, now) : null,
    },
    policy: {
      available: policy !== null && policy !== undefined,
      status: regressions.length === 0 ? 'stable' : 'regressed',
      regressions,
    },
  };
};

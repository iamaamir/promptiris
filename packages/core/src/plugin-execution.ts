import {
  validateJsonValue,
  validatePatch,
  type Artifact,
  type Diagnostic,
  type NamespacedId,
  type Phase,
  type PromptDocument,
  type RunResult,
} from '@promptiris/protocol';
import {
  identityArtifact,
  type ArtifactProposal,
  type PluginImplementation,
  type PluginInvocation,
  type PluginOutput,
  type PluginRegistration,
  type RunContext,
} from '@promptiris/plugin-sdk';
import type { CompiledContribution, CompiledPluginGraph } from './plugin-graph.js';
import {
  applyPatch,
  createTransformationState,
  type TransformationState,
} from './transformation-state.js';
import { createRunLifetime, type RunLifetime, type RunTermination } from './run-lifetime.js';
import { captureDebugRecord, type DebugRecordSink } from './debug-record.js';

/** @public */
export interface ArtifactExposurePolicy {
  readonly primaryKind?: NamespacedId;
  readonly alternativeKinds?: readonly NamespacedId[];
  readonly exposedKinds?: readonly NamespacedId[];
}

/** @public */
export interface ExecutionOptions {
  readonly recipe: { readonly id: string; readonly version: string };
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly artifacts?: ArtifactExposurePolicy;
  readonly debug?: DebugRecordSink;
}

interface ExecutionState {
  current: TransformationState;
  readonly activated: Map<string, PluginImplementation>;
  readonly diagnostics: Diagnostic[];
  readonly artifacts: Artifact[];
  readonly patchIds: string[];
  readonly completedPhases: Phase[];
  readonly failedPhases: Phase[];
  readonly resources: AsyncDisposableStack;
  readonly debug?: DebugRecordSink;
  terminalStatus?: 'cancelled';
  transformed: boolean;
}

type InvocationOutcome =
  | { readonly ok: true; readonly output: PluginOutput }
  | { readonly ok: false; readonly diagnostic: Diagnostic }
  | { readonly ok: false; readonly termination: Exclude<RunTermination, 'active'> };
type ActivationOutcome =
  | { readonly ok: true; readonly implementation: PluginImplementation }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

function coreDiagnostic(code: string, category = 'plugin'): Diagnostic {
  return Object.freeze({
    schemaVersion: '1',
    id: `diagnostic:${code}`,
    code,
    category,
    severity: 'error',
    title: code,
  });
}

function terminationDiagnostic(termination: Exclude<RunTermination, 'active'>): Diagnostic {
  return coreDiagnostic(
    termination === 'timed-out' ? 'promptiris.run.timeout' : 'promptiris.run.cancelled',
    termination === 'timed-out' ? 'timeout' : 'cancellation',
  );
}

function emitPluginEvent(
  context: RunContext,
  type: string,
  node: CompiledContribution,
  status?: 'success' | 'failed',
): void {
  context.emit({
    type,
    source: 'core',
    dataSchema: `promptiris/event/${type.replace('promptiris.', '').replaceAll('.', '-')}-v1`,
    data: {
      pluginId: node.pluginId,
      contributionId: node.contribution.id,
      ...(status === undefined ? {} : { status }),
    },
    classification: 'metadata',
    delivery: 'critical',
  });
}

function emitPhaseEvent(
  context: RunContext,
  type: 'promptiris.phase.started' | 'promptiris.phase.completed',
  phase: Phase,
  status?: 'success' | 'degraded',
): void {
  context.emit({
    type,
    source: 'core',
    dataSchema: `promptiris/event/${type.replace('promptiris.', '').replaceAll('.', '-')}-v1`,
    data: { phase, ...(status === undefined ? {} : { status }) },
    classification: 'metadata',
    delivery: 'critical',
  });
}

function isPluginImplementation(value: unknown): value is PluginImplementation {
  return (
    typeof value === 'object' &&
    value !== null &&
    'invoke' in value &&
    typeof value.invoke === 'function'
  );
}

function pluginDisposer(implementation: PluginImplementation): (() => Promise<void>) | undefined {
  const dispose: unknown = Reflect.get(implementation, Symbol.asyncDispose);
  if (typeof dispose !== 'function') return undefined;
  return async () => {
    const result: unknown = Reflect.apply(dispose, implementation, []);
    await result;
  };
}

function isArtifactClassification(value: unknown): value is ArtifactProposal['classification'] {
  return value === 'public' || value === 'internal' || value === 'sensitive';
}

function hasArtifactIdentity(proposal: Partial<ArtifactProposal>): boolean {
  return (
    typeof proposal.kind === 'string' &&
    proposal.kind.includes('/') &&
    typeof proposal.mediaType === 'string' &&
    proposal.mediaType.length > 0
  );
}

function isArtifactProposal(value: unknown): value is ArtifactProposal {
  if (typeof value !== 'object' || value === null) return false;
  const proposal = value as Partial<ArtifactProposal>;
  return (
    hasArtifactIdentity(proposal) &&
    isArtifactClassification(proposal.classification) &&
    validateJsonValue(proposal.value) &&
    (proposal.extensions === undefined || validateJsonValue(proposal.extensions))
  );
}

function isPluginOutput(value: unknown): value is PluginOutput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'patches' && key !== 'artifacts')) return false;
  const output = value as Partial<PluginOutput>;
  const patchesValid =
    output.patches === undefined ||
    (Array.isArray(output.patches) && output.patches.every((patch) => validatePatch(patch)));
  const artifactsValid =
    output.artifacts === undefined ||
    (Array.isArray(output.artifacts) && output.artifacts.every(isArtifactProposal));
  return patchesValid && artifactsValid;
}

async function activatePlugin(
  registration: PluginRegistration | undefined,
  node: CompiledContribution,
  state: ExecutionState,
  context: RunContext,
): Promise<ActivationOutcome> {
  const cached = state.activated.get(node.pluginId);
  if (cached !== undefined) return { ok: true, implementation: cached };
  emitPluginEvent(context, 'promptiris.plugin.activation-started', node);
  try {
    if (registration === undefined) throw new TypeError();
    const implementation: unknown = await registration.activate();
    if (!isPluginImplementation(implementation)) throw new TypeError();
    state.activated.set(node.pluginId, implementation);
    const dispose = pluginDisposer(implementation);
    if (dispose !== undefined) {
      state.resources.defer(() => Promise.resolve(dispose()));
    }
    emitPluginEvent(context, 'promptiris.plugin.activation-completed', node, 'success');
    return { ok: true, implementation };
  } catch (error) {
    captureDebugRecord(state.debug, error, {
      runId: context.runId,
      traceId: context.runId,
      operation: 'plugin.activate',
      pluginId: node.pluginId,
      contributionId: node.contribution.id,
    });
    emitPluginEvent(context, 'promptiris.plugin.activation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('promptiris.plugin.activation-failed') };
  }
}

async function invokePlugin(
  implementation: PluginImplementation,
  request: PluginInvocation,
  node: CompiledContribution,
  context: RunContext,
  debug: DebugRecordSink | undefined,
): Promise<InvocationOutcome> {
  emitPluginEvent(context, 'promptiris.plugin.invocation-started', node);
  const settled = await settleInvocation(implementation, request);
  if (settled.kind === 'failure') {
    captureDebugRecord(debug, settled.error, {
      runId: context.runId,
      traceId: context.runId,
      operation: 'plugin.invoke',
      pluginId: node.pluginId,
      contributionId: node.contribution.id,
    });
  }
  if (settled.kind === 'cancelled') {
    emitPluginEvent(context, 'promptiris.plugin.invocation-completed', node, 'failed');
    return { ok: false, termination: 'cancelled' };
  }
  if (settled.kind === 'failure') {
    emitPluginEvent(context, 'promptiris.plugin.invocation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('promptiris.plugin.invocation-failed') };
  }
  if (!isPluginOutput(settled.output)) {
    emitPluginEvent(context, 'promptiris.plugin.invocation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('promptiris.plugin.invalid-output') };
  }
  emitPluginEvent(context, 'promptiris.plugin.invocation-completed', node, 'success');
  return { ok: true, output: settled.output };
}

type InvocationSettlement =
  | { readonly kind: 'output'; readonly output: unknown }
  | { readonly kind: 'failure'; readonly error: unknown }
  | { readonly kind: 'cancelled' };

async function settleInvocation(
  implementation: PluginImplementation,
  request: PluginInvocation,
): Promise<InvocationSettlement> {
  const invocation = Promise.resolve()
    .then(() => implementation.invoke(request))
    .then(
      (output: unknown) => ({ kind: 'output' as const, output }),
      (error: unknown) => ({ kind: 'failure' as const, error }),
    );
  let onAbort: (() => void) | undefined;
  const cancellation = new Promise<{ readonly kind: 'cancelled' }>((resolve) => {
    onAbort = () => resolve({ kind: 'cancelled' });
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) onAbort();
  });
  const settled = await Promise.race([invocation, cancellation]);
  if (onAbort !== undefined) request.signal.removeEventListener('abort', onAbort);
  return settled;
}

function ownsNamespace(pluginId: string, key: string): boolean {
  return key === pluginId || key.startsWith(`${pluginId}/`);
}

function artifactNamespacesValid(
  pluginId: string,
  artifacts: readonly ArtifactProposal[],
): boolean {
  return artifacts.every((artifact) =>
    Object.keys(artifact.extensions ?? {}).every((key) => ownsNamespace(pluginId, key)),
  );
}

function stampArtifact(
  proposal: ArtifactProposal,
  node: CompiledContribution,
  context: RunContext,
  ordinal: number,
  patchIds: readonly string[],
): Artifact {
  return Object.freeze({
    schemaVersion: '1',
    id: `artifact:${context.runId}:${String(ordinal)}`,
    kind: proposal.kind,
    mediaType: proposal.mediaType,
    value: structuredClone(proposal.value),
    ...(proposal.dataSchema === undefined ? {} : { dataSchema: { ...proposal.dataSchema } }),
    ...(proposal.digest === undefined ? {} : { digest: proposal.digest }),
    provenance: {
      pluginId: node.pluginId,
      contributionId: node.contribution.id,
      invocationId: `${context.runId}:${node.pluginId}:${node.contribution.id}`,
      phase: node.contribution.phase,
      parentArtifactIds: [],
      patchIds: [...patchIds],
    },
    classification: proposal.classification,
    ...(proposal.extensions === undefined
      ? {}
      : { extensions: structuredClone(proposal.extensions) }),
  });
}

function acceptOutput(
  output: PluginOutput,
  node: CompiledContribution,
  state: ExecutionState,
  context: RunContext,
): Diagnostic | undefined {
  const artifacts = output.artifacts ?? [];
  if (!artifactNamespacesValid(node.pluginId, artifacts)) {
    return coreDiagnostic('promptiris.plugin.invalid-output');
  }
  const patchIds: string[] = [];
  for (const patch of output.patches ?? []) {
    const applied = applyPatch(state.current, patch, node.pluginId);
    if (!applied.ok) return coreDiagnostic(`promptiris.patch.${applied.code}`, 'transformation');
    state.current = applied.state;
    state.transformed = true;
    patchIds.push(patch.id);
    state.patchIds.push(patch.id);
  }
  for (const artifact of artifacts) {
    state.artifacts.push(stampArtifact(artifact, node, context, state.artifacts.length, patchIds));
  }
  return undefined;
}

function publicArtifacts(state: ExecutionState): readonly Artifact[] {
  return state.artifacts.filter((artifact) => artifact.classification === 'public');
}

function firstArtifactOfKind(
  artifacts: readonly Artifact[],
  kind: NamespacedId | undefined,
): Artifact | undefined {
  return kind === undefined ? undefined : artifacts.find((artifact) => artifact.kind === kind);
}

function exposedArtifacts(
  artifacts: readonly Artifact[],
  kinds: readonly NamespacedId[],
): Record<string, Artifact[]> {
  const exposed: Record<string, Artifact[]> = {};
  for (const kind of kinds) {
    const matching = artifacts.filter((artifact) => artifact.kind === kind);
    if (matching.length > 0) exposed[kind] = matching;
  }
  return exposed;
}

function fallbackArtifact(state: ExecutionState, context: RunContext): Artifact {
  return identityArtifact(state.current.document, {
    pluginId: 'promptiris/core',
    contributionId: 'result-fallback',
    invocationId: `${context.runId}:result`,
    phase: 'render',
    parentArtifactIds: [],
    patchIds: [...state.patchIds],
  });
}

function resultArtifacts(
  state: ExecutionState,
  context: RunContext,
  policy: ArtifactExposurePolicy | undefined,
): { primary: Artifact; alternatives: Artifact[]; exposed: Record<string, Artifact[]> } {
  const visible = publicArtifacts(state);
  const primary =
    firstArtifactOfKind(visible, policy?.primaryKind) ?? fallbackArtifact(state, context);
  const alternatives = visible.filter(
    (artifact) =>
      artifact.id !== primary.id && (policy?.alternativeKinds ?? []).includes(artifact.kind),
  );
  return {
    primary,
    alternatives,
    exposed: exposedArtifacts(visible, policy?.exposedKinds ?? []),
  };
}

async function executeContribution(
  node: CompiledContribution,
  registrations: readonly PluginRegistration[],
  state: ExecutionState,
  context: RunContext,
  lifetime: RunLifetime,
): Promise<boolean> {
  if (lifetime.termination !== 'active') {
    markTermination(state, context, lifetime.termination);
    return false;
  }
  const registration = registrations.find((candidate) => candidate.manifest.id === node.pluginId);
  const activation = await activatePlugin(registration, node, state, context);
  if (!activation.ok) {
    state.diagnostics.push(activation.diagnostic);
    return false;
  }
  if (lifetime.termination !== 'active') {
    markTermination(state, context, lifetime.termination);
    return false;
  }
  const outcome = await invokePlugin(
    activation.implementation,
    pluginInvocation(node, state, lifetime.signal),
    node,
    context,
    state.debug,
  );
  return handleInvocationOutcome(outcome, node, state, context, lifetime);
}

function pluginInvocation(
  node: CompiledContribution,
  state: ExecutionState,
  signal: AbortSignal,
): PluginInvocation {
  return {
    contributionId: node.contribution.id,
    input: state.current.document,
    revision: state.current.revision,
    signal,
  };
}

function handleInvocationOutcome(
  outcome: InvocationOutcome,
  node: CompiledContribution,
  state: ExecutionState,
  context: RunContext,
  lifetime: RunLifetime,
): boolean {
  if (!outcome.ok) {
    if ('termination' in outcome) {
      const termination =
        lifetime.termination === 'active' ? outcome.termination : lifetime.termination;
      markTermination(state, context, termination);
    } else state.diagnostics.push(outcome.diagnostic);
    return false;
  }
  const rejected = acceptOutput(outcome.output, node, state, context);
  if (rejected !== undefined) {
    state.diagnostics.push(rejected);
    return false;
  }
  return true;
}

function markTermination(
  state: ExecutionState,
  context: RunContext,
  termination: Exclude<RunTermination, 'active'>,
): void {
  if (state.terminalStatus === 'cancelled') return;
  state.terminalStatus = 'cancelled';
  state.diagnostics.push(terminationDiagnostic(termination));
  context.emit({
    type: 'promptiris.run.cancellation-requested',
    source: 'core',
    dataSchema: 'promptiris/event/run-cancellation-requested-v1',
    data: { reason: termination },
    classification: 'metadata',
    delivery: 'critical',
  });
}

function createResult(
  state: ExecutionState,
  context: RunContext,
  options: ExecutionOptions,
  durationMs: number,
): RunResult {
  const diagnostics = [...state.diagnostics];
  const completedPhases = [...state.completedPhases];
  const failedPhases = [...state.failedPhases];
  const artifacts = resultArtifacts(state, context, options.artifacts);
  Object.freeze(diagnostics);
  Object.freeze(completedPhases);
  Object.freeze(failedPhases);
  return Object.freeze({
    schemaVersion: '1',
    runId: context.runId,
    recipe: options.recipe,
    status: state.terminalStatus ?? (state.diagnostics.length === 0 ? 'success' : 'degraded'),
    primary: artifacts.primary,
    primaryOrigin:
      artifacts.primary.kind !== 'promptiris/prompt' || state.transformed
        ? 'transformed'
        : 'original',
    alternatives: artifacts.alternatives,
    exposed: artifacts.exposed,
    assumptions: [],
    clarifications: [],
    diagnostics,
    summary: {
      traceId: context.runId,
      durationMs,
      completedPhases,
      failedPhases,
    },
  });
}

async function executeNodes(
  graph: CompiledPluginGraph,
  registrations: readonly PluginRegistration[],
  state: ExecutionState,
  context: RunContext,
  lifetime: RunLifetime,
): Promise<void> {
  let activePhase: Phase | undefined;
  for (const node of graph.contributions) {
    if (activePhase !== node.contribution.phase) {
      if (activePhase !== undefined) {
        state.completedPhases.push(activePhase);
        emitPhaseEvent(context, 'promptiris.phase.completed', activePhase, 'success');
      }
      activePhase = node.contribution.phase;
      emitPhaseEvent(context, 'promptiris.phase.started', activePhase);
    }
    if (!(await executeContribution(node, registrations, state, context, lifetime))) {
      if (state.terminalStatus !== 'cancelled') state.failedPhases.push(activePhase);
      emitPhaseEvent(context, 'promptiris.phase.completed', activePhase, 'degraded');
      return;
    }
  }
  if (activePhase !== undefined) {
    state.completedPhases.push(activePhase);
    emitPhaseEvent(context, 'promptiris.phase.completed', activePhase, 'success');
  }
}

/** @public */
export async function executePluginPlan(
  input: PromptDocument,
  graph: CompiledPluginGraph,
  registrations: readonly PluginRegistration[],
  context: RunContext,
  options: ExecutionOptions,
): Promise<RunResult> {
  const started = Date.now();
  using lifetime = createRunLifetime(options);
  const resources = new AsyncDisposableStack();
  const state = executionState(input, resources, options.debug);
  if (lifetime.termination !== 'active') markTermination(state, context, lifetime.termination);
  else if (!graph.ok) {
    state.diagnostics.push(coreDiagnostic('promptiris.recipe.compile-failed', 'configuration'));
  } else {
    await executeNodes(graph, registrations, state, context, lifetime);
  }
  await disposeResources(resources, state, context, options.debug);
  return createResult(state, context, options, Date.now() - started);
}

function executionState(
  input: PromptDocument,
  resources: AsyncDisposableStack,
  debug: DebugRecordSink | undefined,
): ExecutionState {
  return {
    current: createTransformationState(input),
    activated: new Map(),
    diagnostics: [],
    artifacts: [],
    patchIds: [],
    completedPhases: [],
    failedPhases: [],
    resources,
    ...(debug === undefined ? {} : { debug }),
    transformed: false,
  };
}

async function disposeResources(
  resources: AsyncDisposableStack,
  state: ExecutionState,
  context: RunContext,
  debug: DebugRecordSink | undefined,
): Promise<void> {
  try {
    await resources.disposeAsync();
  } catch (error) {
    captureDebugRecord(debug, error, {
      runId: context.runId,
      traceId: context.runId,
      operation: 'plugin.dispose',
    });
    state.diagnostics.push(coreDiagnostic('promptiris.internal.failure', 'internal'));
  }
}

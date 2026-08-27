import {
  validatePromptDocument,
  type Diagnostic,
  type Phase,
  type PromptDocument,
  type RunResult,
} from '@meta-prompt/protocol';
import {
  identityArtifact,
  type PluginImplementation,
  type PluginInvocation,
  type PluginRegistration,
  type RunContext,
} from '@meta-prompt/plugin-sdk';
import type { CompiledContribution, CompiledPluginGraph } from './plugin-graph.js';

/** @public */
export interface ExecutionOptions {
  readonly recipe: { readonly id: string; readonly version: string };
  readonly signal?: AbortSignal;
}

interface ExecutionState {
  current: PromptDocument;
  readonly activated: Map<string, PluginImplementation>;
  readonly diagnostics: Diagnostic[];
  readonly completedPhases: Phase[];
  readonly failedPhases: Phase[];
  transformed: boolean;
}

type InvocationOutcome =
  | { readonly ok: true; readonly document: PromptDocument }
  | { readonly ok: false; readonly diagnostic: Diagnostic };
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

function immutableDocument(input: PromptDocument): PromptDocument {
  const content = input.content.map((block) => Object.freeze({ ...block }));
  Object.freeze(content);
  return Object.freeze({ schemaVersion: '1', content });
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
    dataSchema: `meta-prompt/event/${type.replace('meta-prompt.', '').replaceAll('.', '-')}-v1`,
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
  type: 'meta-prompt.phase.started' | 'meta-prompt.phase.completed',
  phase: Phase,
  status?: 'success' | 'degraded',
): void {
  context.emit({
    type,
    source: 'core',
    dataSchema: `meta-prompt/event/${type.replace('meta-prompt.', '').replaceAll('.', '-')}-v1`,
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

async function activatePlugin(
  registration: PluginRegistration | undefined,
  node: CompiledContribution,
  state: ExecutionState,
  context: RunContext,
): Promise<ActivationOutcome> {
  const cached = state.activated.get(node.pluginId);
  if (cached !== undefined) return { ok: true, implementation: cached };
  emitPluginEvent(context, 'meta-prompt.plugin.activation-started', node);
  try {
    if (registration === undefined) throw new Error('Plugin registration is missing');
    const implementation: unknown = await registration.activate();
    if (!isPluginImplementation(implementation)) throw new Error('Plugin activation is invalid');
    state.activated.set(node.pluginId, implementation);
    emitPluginEvent(context, 'meta-prompt.plugin.activation-completed', node, 'success');
    return { ok: true, implementation };
  } catch {
    emitPluginEvent(context, 'meta-prompt.plugin.activation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('meta-prompt.plugin.activation-failed') };
  }
}

async function invokePlugin(
  implementation: PluginImplementation,
  request: PluginInvocation,
  node: CompiledContribution,
  context: RunContext,
): Promise<InvocationOutcome> {
  emitPluginEvent(context, 'meta-prompt.plugin.invocation-started', node);
  let output: unknown;
  try {
    output = await implementation.invoke(request);
  } catch {
    emitPluginEvent(context, 'meta-prompt.plugin.invocation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('meta-prompt.plugin.invocation-failed') };
  }
  if (!validatePromptDocument(output)) {
    emitPluginEvent(context, 'meta-prompt.plugin.invocation-completed', node, 'failed');
    return { ok: false, diagnostic: coreDiagnostic('meta-prompt.plugin.invalid-output') };
  }
  emitPluginEvent(context, 'meta-prompt.plugin.invocation-completed', node, 'success');
  return { ok: true, document: immutableDocument(output) };
}

async function executeContribution(
  node: CompiledContribution,
  registrations: readonly PluginRegistration[],
  state: ExecutionState,
  context: RunContext,
  signal: AbortSignal,
): Promise<boolean> {
  const registration = registrations.find((candidate) => candidate.manifest.id === node.pluginId);
  const activation = await activatePlugin(registration, node, state, context);
  if (!activation.ok) {
    state.diagnostics.push(activation.diagnostic);
    return false;
  }
  const outcome = await invokePlugin(
    activation.implementation,
    { contributionId: node.contribution.id, input: immutableDocument(state.current), signal },
    node,
    context,
  );
  if (!outcome.ok) {
    state.diagnostics.push(outcome.diagnostic);
    return false;
  }
  state.current = outcome.document;
  state.transformed = true;
  return true;
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
  Object.freeze(diagnostics);
  Object.freeze(completedPhases);
  Object.freeze(failedPhases);
  return Object.freeze({
    schemaVersion: '1',
    runId: context.runId,
    recipe: options.recipe,
    status: state.diagnostics.length === 0 ? 'success' : 'degraded',
    primary: identityArtifact(state.current),
    primaryOrigin: state.transformed ? 'transformed' : 'original',
    alternatives: [],
    exposed: {},
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
  signal: AbortSignal,
): Promise<void> {
  let activePhase: Phase | undefined;
  for (const node of graph.contributions) {
    if (activePhase !== node.contribution.phase) {
      if (activePhase !== undefined) {
        state.completedPhases.push(activePhase);
        emitPhaseEvent(context, 'meta-prompt.phase.completed', activePhase, 'success');
      }
      activePhase = node.contribution.phase;
      emitPhaseEvent(context, 'meta-prompt.phase.started', activePhase);
    }
    if (!(await executeContribution(node, registrations, state, context, signal))) {
      state.failedPhases.push(activePhase);
      emitPhaseEvent(context, 'meta-prompt.phase.completed', activePhase, 'degraded');
      return;
    }
  }
  if (activePhase !== undefined) {
    state.completedPhases.push(activePhase);
    emitPhaseEvent(context, 'meta-prompt.phase.completed', activePhase, 'success');
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
  const state: ExecutionState = {
    current: immutableDocument(input),
    activated: new Map(),
    diagnostics: [],
    completedPhases: [],
    failedPhases: [],
    transformed: false,
  };
  if (!graph.ok)
    state.diagnostics.push(coreDiagnostic('meta-prompt.recipe.compile-failed', 'configuration'));
  else {
    const signal = options.signal ?? new AbortController().signal;
    await executeNodes(graph, registrations, state, context, signal);
  }
  return createResult(state, context, options, Date.now() - started);
}

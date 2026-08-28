import { randomUUID } from 'node:crypto';
import type { Event, PromptDocument, RunResult } from '@meta-prompt/protocol';
import { identityArtifact, type Recipe, type RunContext } from '@meta-prompt/plugin-sdk';
export {
  compilePluginGraph,
  type CompiledContribution,
  type CompiledPluginGraph,
} from './plugin-graph.js';
export {
  executePluginPlan,
  type ArtifactExposurePolicy,
  type ExecutionOptions,
} from './plugin-execution.js';
export {
  applyPatch,
  blockDigest,
  createTransformationState,
  type AppliedPatch,
  type PatchChange,
  type PatchFailureCode,
  type PatchResult,
  type TransformationState,
} from './transformation-state.js';

/** @public */
export const identityRecipe: Recipe = {
  id: 'meta-prompt/identity',
  version: '1.0.0',
  async run(input: PromptDocument, context: RunContext): Promise<RunResult> {
    const started = Date.now();
    context.emit({
      type: 'meta-prompt.phase.started',
      source: 'core',
      dataSchema: 'meta-prompt/event/phase-started-v1',
      data: { phase: 'transform' },
      classification: 'metadata',
      delivery: 'critical',
    });
    context.emit({
      type: 'meta-prompt.phase.completed',
      source: 'core',
      dataSchema: 'meta-prompt/event/phase-completed-v1',
      data: { phase: 'transform', status: 'success' },
      classification: 'metadata',
      delivery: 'critical',
    });
    return {
      schemaVersion: '1',
      runId: context.runId,
      recipe: { id: this.id, version: this.version },
      status: 'success',
      primary: identityArtifact(input),
      primaryOrigin: 'original',
      alternatives: [],
      exposed: {},
      assumptions: [],
      clarifications: [],
      diagnostics: [],
      summary: {
        traceId: context.runId,
        durationMs: Date.now() - started,
        completedPhases: ['transform'],
        failedPhases: [],
      },
    };
  },
};

/** @public */
export function createRunContext(runId: string, emit: (event: Event) => void): RunContext {
  let sequence = 0;
  return {
    runId,
    emit(event) {
      emit({
        ...event,
        schemaVersion: '1',
        id: randomUUID(),
        time: new Date().toISOString(),
        sequence: sequence++,
        runId,
        traceId: runId,
      });
    },
  };
}

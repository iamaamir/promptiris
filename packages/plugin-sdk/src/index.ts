import type { Artifact, Event, PromptDocument, RunResult } from '@meta-prompt/protocol';

/** @public */
export interface RunContext {
  readonly runId: string;
  emit<T>(
    event: Omit<Event<T>, 'schemaVersion' | 'id' | 'time' | 'sequence' | 'runId' | 'traceId'>,
  ): void;
}
/** @public */
export interface Recipe {
  readonly id: string;
  readonly version: string;
  run(input: PromptDocument, context: RunContext): Promise<RunResult>;
}
/** @public */
export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  readonly type: 'recipe' | 'pipeline' | 'guard' | 'provider' | 'observer';
}
/** @public */
export function definePlugin<T extends PluginManifest>(manifest: T): T {
  return Object.freeze(manifest);
}
/** @public */
export function identityArtifact(input: PromptDocument): Artifact {
  return {
    schemaVersion: '1',
    id: 'artifact:identity',
    kind: 'meta-prompt/prompt',
    mediaType: 'text/plain',
    value: input.content.map((block) => block.text).join('\n'),
  };
}

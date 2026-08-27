import type { Artifact, Event, Phase, PromptDocument, RunResult } from '@meta-prompt/protocol';

/** @public */
export interface PluginContribution {
  readonly id: string;
  readonly phase: Phase;
  readonly requires?: readonly string[];
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly conflicts?: readonly string[];
}

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
  readonly contributions?: readonly PluginContribution[];
}
/** @public */
export function definePlugin<T extends PluginManifest>(manifest: T): T {
  const contributions =
    manifest.contributions === undefined
      ? undefined
      : Object.freeze(
          manifest.contributions.map((contribution) =>
            Object.freeze({
              ...contribution,
              requires: contribution.requires && Object.freeze([...contribution.requires]),
              before: contribution.before && Object.freeze([...contribution.before]),
              after: contribution.after && Object.freeze([...contribution.after]),
              conflicts: contribution.conflicts && Object.freeze([...contribution.conflicts]),
            }),
          ),
        );
  return Object.freeze({ ...manifest, contributions });
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

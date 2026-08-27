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
export interface PluginInvocation {
  readonly contributionId: string;
  readonly input: PromptDocument;
  readonly signal: AbortSignal;
}
/** @public */
export interface PluginImplementation {
  invoke(request: PluginInvocation): Promise<unknown>;
}
/** @public */
export interface PluginRegistration {
  readonly manifest: PluginManifest;
  activate(): Promise<PluginImplementation> | PluginImplementation;
}
/** @public */
export interface AppendTextBlockOperation {
  readonly kind: 'append-text-block';
  readonly block: { readonly id: string; readonly text: string };
}
/** @public */
export interface DeclarativeContribution {
  readonly contributionId: string;
  readonly operation: AppendTextBlockOperation;
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

function freezeDeclarativeContribution(
  contribution: DeclarativeContribution,
): DeclarativeContribution {
  return Object.freeze({
    contributionId: contribution.contributionId,
    operation: Object.freeze({
      kind: contribution.operation.kind,
      block: Object.freeze({ ...contribution.operation.block }),
    }),
  });
}

function applyDeclarativeContribution(
  request: PluginInvocation,
  contributions: ReadonlyMap<string, DeclarativeContribution>,
): PromptDocument {
  const contribution = contributions.get(request.contributionId);
  if (contribution?.operation.kind !== 'append-text-block') {
    throw new Error('Declarative contribution is not defined');
  }
  return {
    schemaVersion: '1',
    content: [
      ...request.input.content.map((block) => ({ ...block })),
      { ...contribution.operation.block },
    ],
  };
}

/** @public */
export function defineDeclarativePlugin(
  manifest: PluginManifest,
  contributions: readonly DeclarativeContribution[],
): PluginRegistration {
  const frozen = contributions.map(freezeDeclarativeContribution);
  const indexed = new Map(
    frozen.map((contribution) => [contribution.contributionId, contribution]),
  );
  if (indexed.size !== frozen.length) throw new Error('Duplicate declarative contribution id');
  return Object.freeze({
    manifest: definePlugin(manifest),
    async activate(): Promise<PluginImplementation> {
      return Object.freeze({
        async invoke(request: PluginInvocation): Promise<unknown> {
          return applyDeclarativeContribution(request, indexed);
        },
      });
    },
  });
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

import type {
  Artifact,
  Event,
  JsonValue,
  NamespacedId,
  Patch,
  Phase,
  PromptDocument,
  Provenance,
  ResourceReference,
  RunResult,
  SchemaReference,
  PermissionHint,
} from '@promptiris/protocol';

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
  readonly revision: number;
  readonly signal: AbortSignal;
}
/** @public */
export interface ArtifactProposal {
  readonly kind: NamespacedId;
  readonly mediaType: string;
  readonly value: JsonValue | ResourceReference;
  readonly dataSchema?: SchemaReference;
  readonly digest?: string;
  readonly classification: 'public' | 'internal' | 'sensitive';
  readonly extensions?: Readonly<Record<NamespacedId, JsonValue>>;
}
/** @public */
export interface PluginOutput {
  readonly patches?: readonly Patch[];
  readonly artifacts?: readonly ArtifactProposal[];
}
/** @public */
export interface PluginImplementation {
  invoke(request: PluginInvocation): Promise<PluginOutput>;
  [Symbol.asyncDispose]?(): PromiseLike<void> | void;
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
  /** Package-relative module path; Hosts authorize and resolve it before lazy loading. */
  readonly entrypoint?: string;
  readonly contributions?: readonly PluginContribution[];
  /** JSON Schema reference for this Plugin's configuration subtree. */
  readonly configSchema?: SchemaReference;
  /** Compatibility declarations; Hosts still require scoped evidence. */
  readonly capabilities?: readonly NamespacedId[];
  /** Advisory metadata only; these hints grant no authority. */
  readonly permissionHints?: readonly PermissionHint[];
}

function assertJsonScalar(value: unknown): void {
  if (
    value === undefined ||
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  ) {
    throw new TypeError();
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError();
  }
}

function assertPlainObject(value: object): void {
  if (Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError();
  }
}

function assertJsonValue(value: unknown, active: WeakSet<object>): void {
  assertJsonScalar(value);
  if (typeof value !== 'object' || value === null) return;
  assertPlainObject(value);
  // Stryker disable next-line ConditionalExpression: cycle tracking is an implementation
  // safety mechanism; the public contract only exposes normalized rejection.
  if (active.has(value)) throw new TypeError();
  // Stryker disable next-line CallExpression: removing this call has the same public rejection
  // result through recursion failure, while losing the bounded cycle-detection strategy.
  active.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') throw new TypeError();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true) continue;
    // Stryker disable next-line ConditionalExpression: an accessor has no value field, so the
    // recursive undefined-value guard produces the same normalized public rejection.
    if (!('value' in descriptor)) throw new TypeError();
    assertJsonValue(descriptor.value, active);
  }
  active.delete(value);
}

function assertDataOnly(manifest: PluginManifest): void {
  try {
    assertJsonValue(manifest, new WeakSet());
  } catch {
    throw new Error('Plugin manifest must contain only JSON data');
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

/** @public */
export function definePlugin<T extends PluginManifest>(manifest: T): T {
  assertDataOnly(manifest);
  return deepFreeze(structuredClone(manifest));
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
  pluginId: string,
): PluginOutput {
  const contribution = contributions.get(request.contributionId);
  if (contribution?.operation.kind !== 'append-text-block') {
    throw new Error('Declarative contribution is not defined');
  }
  return {
    patches: [
      {
        schemaVersion: '1',
        id: `${pluginId}:${request.contributionId}`,
        baseRevision: request.revision,
        operations: [{ type: 'insert-content-block', block: { ...contribution.operation.block } }],
      },
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
        async invoke(request: PluginInvocation): Promise<PluginOutput> {
          return applyDeclarativeContribution(request, indexed, manifest.id);
        },
      });
    },
  });
}
/** @public */
export function identityArtifact(
  input: PromptDocument,
  provenance: Provenance = {
    pluginId: 'promptiris/core',
    contributionId: 'identity',
    invocationId: 'identity',
    phase: 'render',
    parentArtifactIds: [],
    patchIds: [],
  },
): Artifact {
  return {
    schemaVersion: '1',
    id: 'artifact:identity',
    kind: 'promptiris/prompt',
    mediaType: 'text/plain',
    value: input.content.map((block) => block.text).join('\n'),
    provenance,
    classification: 'public',
  };
}

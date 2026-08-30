/**
 * Model-neutral text-generation contract for promptiris plugins.
 *
 * All types in this module are self-contained so the plugin-sdk can be
 * consumed without pulling in protocol validation machinery.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Local type definitions (mirrors the protocol surface without the dependency)
// ---------------------------------------------------------------------------

/** @public */
export type ModelCapability = 'text-generation' | 'structured-output' | 'tool-use';

/** @public */
export type ProviderErrorKind =
  | 'unsupported-capability'
  | 'cancelled'
  | 'malformed-output'
  | 'timeout'
  | 'rate-limit'
  | 'authentication'
  | 'network'
  | 'unknown';

/** @public */
export interface ModelBinding {
  readonly modelId: string;
  readonly providerId: string;
  readonly fingerprint: string;
}

/** @public */
export interface ProviderCapabilities {
  readonly supported: readonly ModelCapability[];
  readonly unsupported: readonly ModelCapability[];
}

/** @public */
export interface ProviderConfig {
  readonly id: string;
  readonly binding: ModelBinding;
  readonly capabilities: ProviderCapabilities;
  readonly secretRef?: { readonly ref: string };
  readonly endpoint?: string;
}

/** @public */
export interface GenerateMessage {
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
}

/** @public */
export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** @public */
export interface GenerateResult {
  readonly content: string;
  readonly model: string;
  readonly usage: Usage;
  readonly finishReason: 'stop' | 'length' | 'content-filter' | 'error';
}

/** @public */
export interface CapabilityEvidence {
  readonly evidenceId: string;
  readonly capability: string;
  readonly bindingFingerprint: string;
  readonly state: 'supported' | 'unsupported' | 'unknown';
  readonly source: { readonly kind: string; readonly id: string };
  readonly digest?: string;
  readonly observedAt?: string;
  readonly reason?: string;
}

/** @public */
export interface GenerateParams {
  readonly config: ProviderConfig;
  readonly messages: readonly GenerateMessage[];
  readonly system?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** AbortSignal is platform-specific and cannot be serialized. */
  readonly signal?: AbortSignal;
  /** Capability evidence bound to the active Provider configuration fingerprint. */
  readonly evidence?: readonly CapabilityEvidence[];
}

// ---------------------------------------------------------------------------
// Provider contract
// ---------------------------------------------------------------------------

/**
 * Runtime-neutral text generation contract.
 *
 * A Provider receives validated GenerateParams and returns a deterministic
 * GenerateResult or a normalized ProviderError. No OpenAI-specific fields
 * enter this interface.
 *
 * @public
 */
export interface Provider {
  readonly config: ProviderConfig;
  generate(params: GenerateParams): Promise<GenerateResult>;
  [Symbol.asyncDispose]?(): PromiseLike<void> | void;
}

// ---------------------------------------------------------------------------
// FakeProvider test harness
// ---------------------------------------------------------------------------

/**
 * Scenario for the FakeProvider test harness.
 *
 * @public
 */
export interface FakeProviderScenario {
  readonly id: string;
  readonly description: string;
  readonly capabilities: readonly ModelCapability[];
  readonly responses: readonly FakeProviderResponse[];
}

/**
 * A single response the FakeProvider will return in sequence.
 *
 * @public
 */
export type FakeProviderResponse =
  | { readonly kind: 'success'; readonly result: GenerateResult }
  | { readonly kind: 'error'; readonly failureKind: ProviderErrorKind; readonly message: string };

/**
 * Error thrown by the FakeProvider to represent a classified failure.
 *
 * @public
 */
export class ProviderFailureError extends Error {
  readonly failureKind: ProviderErrorKind;
  readonly retryable: boolean;

  constructor(failureKind: ProviderErrorKind, message: string, retryable = false) {
    super(message);
    this.name = 'ProviderFailureError';
    this.failureKind = failureKind;
    this.retryable = retryable;
  }
}

const RETRYABLE_KINDS: readonly ProviderErrorKind[] = ['timeout', 'rate-limit', 'network'];

/**
 * Deterministic in-memory Provider for conformance testing.
 *
 * The FakeProvider replays a fixed sequence of responses, making it suitable
 * for property tests, integration fixtures, and mutation targets. It validates
 * that requested capabilities have evidence bound to the active Provider
 * configuration fingerprint before returning.
 *
 * @public
 */
export class FakeProvider implements Provider {
  readonly config: ProviderConfig;
  readonly #scenarios: Map<string, FakeProviderScenario>;
  readonly #counters: Map<string, number>;

  constructor(scenarios: readonly FakeProviderScenario[]) {
    this.#scenarios = new Map(scenarios.map((s) => [s.id, s]));
    this.#counters = new Map();

    const first = scenarios[0];
    if (!first) throw new Error('FakeProvider requires at least one scenario');

    this.config = {
      id: 'promptiris/fake-provider',
      binding: {
        modelId: 'fake-model-v1',
        providerId: 'promptiris/fake-provider',
        fingerprint: 'fake-fp-001',
      },
      capabilities: {
        supported: [...first.capabilities],
        unsupported: [],
      },
    };
  }

  getScenario(id: string): FakeProviderScenario | undefined {
    return this.#scenarios.get(id);
  }

  generate(params: GenerateParams): Promise<GenerateResult> {
    const scenario = this.#resolveScenario(params);

    this.#validateCapabilityEvidence(params);

    for (const cap of params.config.capabilities.supported) {
      if (!scenario.capabilities.includes(cap)) {
        throw new ProviderFailureError(
          'unsupported-capability',
          `capability ${cap} is not supported by this scenario`,
        );
      }
    }

    if (params.signal?.aborted) {
      throw new ProviderFailureError('cancelled', 'generation cancelled');
    }

    return this.#nextResponse(scenario, params.signal);
  }

  #validateCapabilityEvidence(params: GenerateParams): void {
    if (params.evidence === undefined) return;
    const fingerprint = params.config.binding.fingerprint;
    const hasBoundEvidence = params.evidence.some(
      (e) => e.bindingFingerprint === fingerprint && e.state === 'supported',
    );
    if (!hasBoundEvidence && params.config.capabilities.supported.length > 0) {
      throw new ProviderFailureError(
        'unsupported-capability',
        `no supported evidence bound to fingerprint ${fingerprint}`,
      );
    }
  }

  #resolveScenario(params: GenerateParams): FakeProviderScenario {
    const key =
      params.config.binding.fingerprint === 'fake-fp-001'
        ? (this.#scenarios.keys().next().value ?? 'default')
        : params.config.binding.fingerprint;
    const scenario = this.#scenarios.get(key) ?? this.#scenarios.values().next().value;
    if (!scenario) throw new Error('no scenarios configured');
    return scenario;
  }

  #nextResponse(scenario: FakeProviderScenario, signal?: AbortSignal): Promise<GenerateResult> {
    const index = this.#counters.get(scenario.id) ?? 0;
    const response = scenario.responses[index % scenario.responses.length];
    if (!response) throw new Error('no responses configured');
    this.#counters.set(scenario.id, index + 1);

    if (response.kind === 'error') {
      const retryable = RETRYABLE_KINDS.includes(response.failureKind);
      throw new ProviderFailureError(response.failureKind, response.message, retryable);
    }

    if (signal?.aborted) {
      throw new ProviderFailureError('cancelled', 'generation cancelled during work');
    }

    return Promise.resolve(response.result);
  }
}

/**
 * Build a success GenerateResult with sensible defaults.
 *
 * @public
 */
export function makeGenerateResult(overrides?: Partial<GenerateResult>): GenerateResult {
  return {
    content: 'Enhanced prompt output.',
    model: 'fake-model-v1',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    finishReason: 'stop',
    ...overrides,
  };
}

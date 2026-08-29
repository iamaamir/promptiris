import type {
  GenerateParams,
  GenerateResult,
  ModelCapability,
  ProviderConfig,
} from '@promptiris/protocol';

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
  | { readonly kind: 'error'; readonly message: string };

/**
 * Error thrown by the FakeProvider to represent a classified failure.
 *
 * @public
 */
export class ProviderFailureError extends Error {
  readonly failureKind: string;
  readonly retryable: boolean;

  constructor(failureKind: string, message: string, retryable = false) {
    super(message);
    this.name = 'ProviderFailureError';
    this.failureKind = failureKind;
    this.retryable = retryable;
  }
}

/**
 * Deterministic in-memory Provider for conformance testing.
 *
 * The FakeProvider replays a fixed sequence of responses, making it suitable
 * for property tests, integration fixtures, and mutation targets. It validates
 * that requested capabilities are declared as supported before returning.
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

    return this.#nextResponse(scenario);
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

  #nextResponse(scenario: FakeProviderScenario): Promise<GenerateResult> {
    const index = this.#counters.get(scenario.id) ?? 0;
    const response = scenario.responses[index % scenario.responses.length];
    if (!response) throw new Error('no responses configured');
    this.#counters.set(scenario.id, index + 1);

    if (response.kind === 'error') {
      throw new ProviderFailureError(response.message, response.message);
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

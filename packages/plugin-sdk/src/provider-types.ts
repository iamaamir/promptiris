/**
 * Local type definitions for the Provider contract.
 * Separated from provider.ts to avoid Stryker CompileError mutations on
 * pure TypeScript type-only code.
 *
 * @module
 */

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

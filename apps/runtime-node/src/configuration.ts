import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  evaluateCapabilities,
  parseJsonc,
  resolveConfiguration,
  type CapabilityRequirementInput,
  type SchemaRule,
} from '@promptiris/core';
import type {
  CapabilityEvidence,
  CapabilityResolution,
  ConfigTrace,
  JsonValue,
  NamespacedId,
  PolicyRecord,
} from '@promptiris/protocol';

const requirementSchema: SchemaRule = {
  type: 'object',
  properties: {
    capability: { type: 'string' },
    bindingFingerprint: { type: 'string' },
    requirement: { type: 'string' },
  },
};

const evidenceSchema: SchemaRule = {
  type: 'object',
  properties: {
    evidenceId: { type: 'string' },
    capability: { type: 'string' },
    bindingFingerprint: { type: 'string' },
    state: { type: 'string' },
    source: {
      type: 'object',
      properties: { kind: { type: 'string' }, id: { type: 'string' } },
    },
    digest: { type: 'string' },
  },
};

const tracerSchema: SchemaRule = {
  type: 'object',
  merge: true,
  properties: {
    provider: {
      type: 'object',
      merge: true,
      properties: {
        bindingFingerprint: { type: 'string' },
        apiKey: { type: 'secret-reference', sensitive: true },
      },
    },
    capabilities: { type: 'array', items: requirementSchema, default: [] },
    evidence: { type: 'array', items: evidenceSchema, default: [] },
  },
};

interface ProjectConfig {
  readonly capabilities: JsonValue[];
  readonly evidence: JsonValue[];
}

export type ConfigurationLoadResult =
  | {
      readonly ok: true;
      readonly config: JsonValue;
      readonly trace: ConfigTrace;
      readonly policies: readonly PolicyRecord[];
      readonly resolutions: readonly CapabilityResolution[];
    }
  | { readonly ok: false };

function invalid(): ConfigurationLoadResult {
  return { ok: false };
}

function localFilename(uri: string): string | undefined {
  try {
    const url = new URL(uri);
    return url.protocol === 'file:' ? fileURLToPath(url) : undefined;
  } catch {
    return uri;
  }
}

async function readConfiguration(uri: string): Promise<string | undefined> {
  const filename = localFilename(uri);
  if (!filename) return undefined;
  try {
    return await readFile(filename, 'utf8');
  } catch {
    return undefined;
  }
}

function namespaced(value: unknown): value is NamespacedId {
  return typeof value === 'string' && /^[^/\s]+\/[^/\s]+$/.test(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function jsonRecord(value: JsonValue): Readonly<Record<string, JsonValue>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value;
}

function requirement(value: JsonValue): CapabilityRequirementInput | undefined {
  const item = jsonRecord(value);
  if (!item) return undefined;
  const kind = item.requirement;
  if (!namespaced(item.capability) || !nonempty(item.bindingFingerprint)) return undefined;
  if (kind !== 'required' && kind !== 'preferred' && kind !== 'optional') return undefined;
  return {
    capability: item.capability,
    bindingFingerprint: item.bindingFingerprint,
    requirement: kind,
  };
}

function evidenceSource(value: JsonValue | undefined) {
  if (value === undefined) return undefined;
  const item = jsonRecord(value);
  if (!item) return undefined;
  if (!nonempty(item.id)) return undefined;
  const kind = item.kind;
  if (kind !== 'policy' && kind !== 'configuration' && kind !== 'profile' && kind !== 'observation')
    return undefined;
  return { kind, id: item.id } as const;
}

function evidenceState(value: unknown) {
  return value === 'supported' || value === 'unsupported' || value === 'unknown'
    ? value
    : undefined;
}

function evidence(value: JsonValue): CapabilityEvidence | undefined {
  const item = jsonRecord(value);
  if (!item) return undefined;
  const source = evidenceSource(item.source);
  const state = evidenceState(item.state);
  if (!source || !namespaced(item.capability) || !nonempty(item.evidenceId)) return undefined;
  if (!nonempty(item.bindingFingerprint)) return undefined;
  if (!state) return undefined;
  if (item.digest !== undefined && typeof item.digest !== 'string') return undefined;
  return {
    evidenceId: item.evidenceId,
    capability: item.capability,
    bindingFingerprint: item.bindingFingerprint,
    state,
    source,
    ...(item.digest === undefined ? {} : { digest: item.digest }),
  };
}

function collect<T>(
  values: readonly JsonValue[],
  convert: (value: JsonValue) => T | undefined,
): readonly T[] | undefined {
  const converted: T[] = [];
  for (const value of values) {
    const item = convert(value);
    if (item === undefined) return undefined;
    converted.push(item);
  }
  return converted;
}

function capabilityResolutions(config: ProjectConfig): readonly CapabilityResolution[] | undefined {
  const requirements = collect(config.capabilities, requirement);
  const evidenceItems = collect(config.evidence, evidence);
  if (!requirements || !evidenceItems) return undefined;
  return evaluateCapabilities(requirements, evidenceItems);
}

function projectConfig(value: JsonValue): ProjectConfig | undefined {
  const record = jsonRecord(value);
  if (!record || !Array.isArray(record.capabilities) || !Array.isArray(record.evidence))
    return undefined;
  return { capabilities: record.capabilities, evidence: record.evidence };
}

export async function loadConfiguration(uri: string): Promise<ConfigurationLoadResult> {
  const text = await readConfiguration(uri);
  if (text === undefined) return invalid();
  const parsed = parseJsonc(text, { sourceId: 'project', uri });
  if (!parsed.ok) return invalid();
  const resolved = resolveConfiguration({
    schema: tracerSchema,
    layers: [{ sourceId: 'project', value: parsed.value, location: { uri } }],
  });
  if (!resolved.ok) return invalid();
  const config = projectConfig(resolved.config);
  if (!config) return invalid();
  const resolutions = capabilityResolutions(config);
  if (!resolutions) return invalid();
  return {
    ok: true,
    config: resolved.config,
    trace: resolved.trace,
    policies: [],
    resolutions,
  };
}

import type {
  ConfigTrace,
  ConfigTraceCandidate,
  ConfigTraceEntry,
  Diagnostic,
  JsonValue,
  PolicyRecord,
  SourceLocation,
} from '@promptiris/protocol';
import {
  deepFrozenClone,
  configPointer,
  safePreview,
  validateConfig,
  type SchemaRule,
} from './configuration-schema.js';
export interface ConfigLayer {
  readonly sourceId: string;
  readonly location?: SourceLocation;
  readonly value: unknown;
}
export type ConfigPolicy =
  | {
      readonly policyId: string;
      readonly action: 'allowed';
      readonly pointer: string;
      readonly reason?: string;
      readonly sourceId?: string;
    }
  | {
      readonly policyId: string;
      readonly action: 'forced';
      readonly pointer: string;
      readonly value: unknown;
      readonly reason?: string;
      readonly sourceId?: string;
    }
  | {
      readonly policyId: string;
      readonly action: 'clamped';
      readonly pointer: string;
      readonly min?: number;
      readonly max?: number;
      readonly reason?: string;
      readonly sourceId?: string;
    }
  | {
      readonly policyId: string;
      readonly action: 'denied';
      readonly pointer: string;
      readonly reason?: string;
      readonly sourceId?: string;
    };
export interface ResolveParams {
  readonly schema: SchemaRule;
  readonly layers: readonly ConfigLayer[];
  readonly policies?: readonly ConfigPolicy[];
}
export type ResolveResult =
  | {
      readonly ok: true;
      readonly config: JsonValue;
      readonly trace: ConfigTrace;
      readonly policies: readonly PolicyRecord[];
    }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

const fail = (detail: string): ResolveResult => ({
  ok: false,
  diagnostic: {
    schemaVersion: '1',
    id: 'promptiris.config.invalid',
    code: 'promptiris.config.invalid',
    category: 'configuration',
    severity: 'error',
    title: 'Invalid configuration',
    detail,
  },
});
const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const eq = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : isObj(v)
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
          .join(',')}}`
      : JSON.stringify(v);
const clone = (v: unknown): JsonValue => deepFrozenClone(v as JsonValue);
const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) freeze(child);
  }
  return v;
};
const decodePointerPart = (part: string): string =>
  part.replace(/~([01])/g, (_escape, digit: string) => (digit === '1' ? '/' : '~'));
const pointerParts = (pointer: string): readonly string[] =>
  pointer.slice(1).split('/').map(decodePointerPart);
const at = (root: unknown, pointer: string): unknown => {
  if (!pointer) return root;
  let value = root;
  for (const part of pointerParts(pointer)) {
    if (!isObj(value)) return undefined;
    value = value[part];
  }
  return value;
};
const setAt = (root: unknown, pointer: string, value: unknown): unknown => {
  if (!pointer) return value;
  const parts = pointerParts(pointer);
  if (!isObj(root)) return undefined;
  const out = { ...root };
  let target: Record<string, unknown> = out;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (part === undefined || !isObj(target[part])) return undefined;
    target[part] = { ...target[part] };
    target = target[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (last === undefined) return undefined;
  target[last] = value;
  return out;
};
/* eslint-disable complexity */
const merge = (rule: SchemaRule, values: readonly unknown[]): unknown => {
  const present = values.filter((v) => v !== undefined);
  if (rule.type === 'object' && rule.merge === true) {
    const sources = rule.default === undefined ? present : [rule.default, ...present];
    const keys = new Set(Object.keys(rule.properties));
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const child = rule.properties[key];
      if (!child) continue;
      const merged = merge(
        child,
        sources.map((v) => (isObj(v) ? v[key] : undefined)),
      );
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  if (rule.type === 'array' && rule.merge && rule.merge !== 'replace') {
    const sources = rule.default === undefined ? present : [rule.default, ...present];
    const arrays = sources.filter(Array.isArray) as unknown[][];
    const items = arrays.flat();
    return rule.merge === 'union'
      ? items.filter((v, i) => items.findIndex((x) => eq(x, v)) === i)
      : items;
  }
  if (!present.length) return rule.default;
  return present.at(-1);
};
/* eslint-enable complexity */
const acceptsAllCandidates = (schema: SchemaRule): boolean =>
  (schema.type === 'array' && (schema.merge === 'append' || schema.merge === 'union')) ||
  (schema.type === 'object' && schema.merge === true);

function traceCandidates(
  schema: SchemaRule,
  layers: readonly ConfigLayer[],
  pointer: string,
): ConfigTraceCandidate[] {
  const accepting = acceptsAllCandidates(schema);
  return layers
    .filter((l) => at(l.value, pointer) !== undefined)
    .map((l, i, a) => {
      const disposition = accepting || i === a.length - 1 ? 'accepted' : 'overridden';
      return {
        sourceId: l.sourceId,
        ...(l.location ? { location: l.location } : {}),
        disposition,
        preview: safePreview(schema, at(l.value, pointer) as JsonValue),
        reason:
          disposition === 'accepted'
            ? accepting
              ? 'contributes through schema merge'
              : 'highest-precedence candidate'
            : 'overridden by higher-precedence candidate',
      };
    });
}

const trace = (
  schema: SchemaRule,
  layers: readonly ConfigLayer[],
  pointer = '',
): ConfigTraceEntry => {
  const candidates = traceCandidates(schema, layers, pointer);
  const effectiveSource =
    candidates.at(-1)?.sourceId ?? (schema.default !== undefined ? 'default' : undefined);
  return {
    pointer,
    schemaRule: schema.type,
    candidates,
    merge:
      schema.type === 'array'
        ? (schema.merge ?? 'replace')
        : schema.type === 'object' && schema.merge
          ? 'merge'
          : 'replace',
    ...(effectiveSource === undefined ? {} : { effectiveSource }),
  };
};
const schemaAt = (schema: SchemaRule, pointer: string): SchemaRule | undefined => {
  let rule = schema;
  if (!pointer) return rule;
  for (const part of pointerParts(pointer)) {
    if (rule.type === 'object') {
      const child = rule.properties[part];
      if (!child) return undefined;
      rule = child;
    } else return undefined;
  }
  return rule;
};
const validPointer = (pointer: string): boolean =>
  pointer === '' || /^(?:\/(?:[^~/]|~[01])*)+$/.test(pointer);
const makeTrace = (
  schema: SchemaRule,
  layers: readonly ConfigLayer[],
  pointer = '',
  out: Record<string, ConfigTraceEntry> = {},
): ConfigTrace => {
  out[pointer] = trace(schema, layers, pointer);
  if (schema.type === 'object')
    for (const [k, r] of Object.entries(schema.properties))
      makeTrace(r, layers, configPointer(pointer, k), out);
  return { entries: out };
};
const policyRecord = (p: ConfigPolicy): PolicyRecord => ({
  policyId: p.policyId,
  decision: p.action,
  pointer: p.pointer,
  ...(p.sourceId ? { sourceId: p.sourceId } : {}),
  reason: p.reason ?? `Policy ${p.action} applied.`,
});
type PolicyMutationResult =
  | { readonly ok: true; readonly config: unknown }
  | { readonly ok: false; readonly diagnostic: Diagnostic };
const applyOnePolicy = (
  config: unknown,
  policy: ConfigPolicy,
  schema: SchemaRule,
): PolicyMutationResult => {
  if (!validPointer(policy.pointer) || !schemaAt(schema, policy.pointer))
    return fail(`Policy ${policy.policyId} references an invalid pointer.`);
  const current = at(config, policy.pointer);
  if (policy.action === 'allowed' || (policy.action === 'denied' && current === undefined))
    return { ok: true, config };
  if (policy.action === 'denied') return fail(`Policy ${policy.policyId} denied configuration.`);
  if (policy.action === 'forced') return forcePolicy(config, policy, schema);
  return clampPolicy(config, current, policy);
};

function forcePolicy(
  config: unknown,
  policy: Extract<ConfigPolicy, { readonly action: 'forced' }>,
  schema: SchemaRule,
): PolicyMutationResult {
  const next = setAt(config, policy.pointer, policy.value);
  const check = validateConfig(schema, next);
  return check.ok ? ({ ok: true, config: next } as const) : check;
}

function clampPolicy(
  config: unknown,
  current: unknown,
  policy: Extract<ConfigPolicy, { readonly action: 'clamped' }>,
): PolicyMutationResult {
  if (
    typeof current !== 'number' ||
    !Number.isFinite(current) ||
    (policy.min !== undefined && policy.max !== undefined && policy.min > policy.max)
  )
    return fail(`Policy ${policy.policyId} is invalid.`);
  return {
    ok: true,
    config: setAt(
      config,
      policy.pointer,
      Math.min(policy.max ?? current, Math.max(policy.min ?? current, current)),
    ),
  } as const;
}

function applyPolicies(
  config: unknown,
  policies: readonly ConfigPolicy[],
  schema: SchemaRule,
): { ok: true; config: unknown; records: PolicyRecord[] } | { ok: false; diagnostic: Diagnostic } {
  const records: PolicyRecord[] = [];
  for (const policy of policies) {
    const result = applyOnePolicy(config, policy, schema);
    if (!result.ok) return result;
    config = result.config;
    records.push(policyRecord(policy));
  }
  return { ok: true, config, records };
}

export function resolveConfiguration(params: ResolveParams): ResolveResult {
  for (const layer of params.layers) {
    const checked = validateConfig(params.schema, layer.value);
    if (!checked.ok) return checked;
  }
  let config = merge(
    params.schema,
    params.layers.map((l) => l.value),
  );
  const applied = applyPolicies(config, params.policies ?? [], params.schema);
  if (!applied.ok) return applied;
  config = applied.config;
  const checked = validateConfig(params.schema, config);
  if (!checked.ok) return checked;
  return {
    ok: true,
    config: clone(config),
    trace: freeze(makeTrace(params.schema, params.layers)),
    policies: freeze(applied.records.map((r) => Object.freeze(r))),
  };
}

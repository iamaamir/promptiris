import type { Diagnostic, JsonValue, SafePreview } from '@promptiris/protocol';
import { validateSecretReference } from './configuration-jsonc.js';

interface RuleOptions {
  readonly default?: JsonValue;
  readonly nullable?: boolean;
  readonly sensitive?: boolean;
}
export type SchemaRule =
  | ({ readonly type: 'string' } & RuleOptions)
  | ({ readonly type: 'number' } & RuleOptions)
  | ({ readonly type: 'integer' } & RuleOptions)
  | ({ readonly type: 'boolean' } & RuleOptions)
  | ({ readonly type: 'null' } & RuleOptions)
  | ({ readonly type: 'secret-reference' } & RuleOptions)
  | ({
      readonly type: 'array';
      readonly items: SchemaRule;
      readonly merge?: 'replace' | 'append' | 'union';
    } & RuleOptions)
  | ({
      readonly type: 'object';
      readonly properties: Readonly<Record<string, SchemaRule>>;
      readonly merge?: boolean;
    } & RuleOptions);

export type SchemaResult =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

function escape(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}
export function configPointer(parent: string, key: string | number): string {
  return `${parent}/${escape(String(key))}`;
}

function diagnostic(pointer: string, code: string, detail: string): Diagnostic {
  return Object.freeze({
    schemaVersion: '1',
    id: code,
    code,
    category: 'configuration',
    severity: 'error',
    title: 'Invalid configuration',
    detail: `${detail} at ${pointer || '/'}.`,
  });
}

interface ValidationIssue {
  readonly pointer: string;
}

function scalarValid(rule: SchemaRule, value: unknown): boolean {
  switch (rule.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return false;
    case 'secret-reference':
      return validSecret(value);
    default:
      return false;
  }
}

function validSecret(value: unknown): boolean {
  return validateSecretReference(value);
}

function findIssue(rule: SchemaRule, value: unknown, pointer: string): ValidationIssue | undefined {
  if (value === null)
    return rule.nullable === true || rule.type === 'null' ? undefined : { pointer };
  if (rule.type === 'array') return findArrayIssue(rule, value, pointer);
  if (rule.type === 'object') return findObjectIssue(rule, value, pointer);
  return scalarValid(rule, value) ? undefined : { pointer };
}

function findObjectIssue(
  rule: Extract<SchemaRule, { readonly type: 'object' }>,
  value: unknown,
  pointer: string,
): ValidationIssue | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { pointer };
  for (const [key, item] of Object.entries(value)) {
    if (rule.properties[key] === undefined) return { pointer: configPointer(pointer, key) };
    const issue = findIssue(rule.properties[key], item, configPointer(pointer, key));
    if (issue) return issue;
  }
  return undefined;
}

function findArrayIssue(
  rule: Extract<SchemaRule, { readonly type: 'array' }>,
  value: unknown,
  pointer: string,
): ValidationIssue | undefined {
  if (!Array.isArray(value)) return { pointer };
  for (let index = 0; index < value.length; index += 1) {
    const issue = findIssue(rule.items, value[index], configPointer(pointer, index));
    if (issue) return issue;
  }
  return undefined;
}

export function validateConfig(schema: SchemaRule, value: unknown, pointer = ''): SchemaResult {
  const candidate = value === undefined && schema.default !== undefined ? schema.default : value;
  const issue = findIssue(schema, candidate, pointer);
  if (!issue) return { ok: true, value: deepFrozenClone(candidate as JsonValue) };
  return {
    ok: false,
    diagnostic: diagnostic(
      issue.pointer,
      'promptiris.config.invalid',
      'Value does not match schema',
    ),
  };
}

export function safePreview(schema: SchemaRule, value: JsonValue): SafePreview {
  if (schema.sensitive === true) return { kind: 'redacted' };
  if (schema.type === 'secret-reference' && validateSecretReference(value)) {
    return { kind: 'secret-reference', scheme: value.ref.split(':', 1)[0] ?? '' };
  }
  if (schema.type === 'array' || schema.type === 'object') return { kind: 'redacted' };
  return { kind: 'literal', value: deepFrozenClone(value) };
}

export function deepFrozenClone(value: JsonValue): JsonValue {
  if (Array.isArray(value))
    return Object.freeze(value.map(deepFrozenClone)) as unknown as JsonValue;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = deepFrozenClone(item);
    return Object.freeze(copy);
  }
  return value;
}

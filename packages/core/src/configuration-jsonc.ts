import { parse, visit, type ParseErrorCode } from 'jsonc-parser';
import type { Diagnostic, JsonValue, SecretReference, SourceLocation } from '@promptiris/protocol';

export interface JsoncSource {
  readonly sourceId: string;
  readonly uri?: string;
}

export interface JsoncDiagnostic extends Diagnostic {
  readonly sourceId: string;
  readonly location?: SourceLocation;
}

export type JsoncResult =
  | { readonly ok: true; readonly value: JsonValue; readonly source: JsoncSource }
  | { readonly ok: false; readonly diagnostics: readonly JsoncDiagnostic[] };

export type ParseJsoncOptions = JsoncSource;

function diagnostic(
  code: string,
  detail: string,
  source: JsoncSource,
  location?: SourceLocation,
): JsoncDiagnostic {
  return Object.freeze({
    schemaVersion: '1',
    id: `configuration.${code}`,
    code,
    category: 'configuration',
    severity: 'error',
    title: 'Invalid configuration',
    detail,
    sourceId: source.sourceId,
    ...(location ? { location } : {}),
  });
}

function location(text: string, offset: number, source: JsoncSource): SourceLocation {
  const prefix = text.slice(0, offset);
  const line = (prefix.match(/\n/g)?.length ?? 0) + 1;
  const lastBreak = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'));
  return { ...(source.uri ? { uri: source.uri } : {}), line, column: offset - lastBreak };
}

function freeze(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze)) as unknown as JsonValue;
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) copy[key] = freeze(item);
    return Object.freeze(copy);
  }
  return value;
}

export function parseJsonc(text: string, options: ParseJsoncOptions): JsoncResult {
  const source: JsoncSource = Object.freeze({
    sourceId: options.sourceId,
    ...(options.uri ? { uri: options.uri } : {}),
  });
  const errors: { error: ParseErrorCode; offset: number; length: number }[] = [];
  const value: unknown = parse(text, errors, {
    allowTrailingComma: true,
  });
  const diagnostics: JsoncDiagnostic[] = errors.map((error) =>
    diagnostic(
      'promptiris.config.invalid-jsonc',
      'JSONC syntax is invalid.',
      source,
      location(text, error.offset, source),
    ),
  );
  diagnostics.push(...duplicateDiagnostics(text, source));
  if (diagnostics.length > 0) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) };
  }
  return { ok: true, value: freeze(value as JsonValue), source };
}

function duplicateDiagnostics(text: string, source: JsoncSource): JsoncDiagnostic[] {
  const diagnostics: JsoncDiagnostic[] = [];
  const seen = new Set<string>();
  visit(text, {
    onObjectProperty(property, offset, _length, _line, _column, pathSupplier) {
      const path = [...pathSupplier(), property]
        .map((segment) => String(segment).replace(/~/g, '~0').replace(/\//g, '~1'))
        .join('/');
      if (seen.has(path))
        diagnostics.push(
          diagnostic(
            'promptiris.config.duplicate-key',
            'Duplicate object property.',
            source,
            location(text, offset, source),
          ),
        );
      seen.add(path);
    },
  });
  return diagnostics;
}

export function validateSecretReference(value: unknown): value is SecretReference {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 &&
    typeof record.ref === 'string' &&
    /^[a-z][a-z0-9+.-]*:[A-Za-z0-9._~/-]+$/.test(record.ref)
  );
}

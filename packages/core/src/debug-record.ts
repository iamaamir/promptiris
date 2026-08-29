import { randomUUID } from 'node:crypto';

const MAX_TEXT = 4_096;
const MAX_CAUSES = 8;

/** @public */
export interface DebugException {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly causes?: readonly DebugException[];
}

/** @public */
export interface DebugRecord {
  readonly id: string;
  readonly runId: string;
  readonly traceId: string;
  readonly operation: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
  readonly exception: DebugException;
}

/** @public */
export interface DebugRecordSink {
  /**
   * Receives an ephemeral bounded record. Sinks must bound retention and redact
   * records again before persistence or export.
   */
  capture(record: DebugRecord): void;
}

/** @public */
export interface DebugRecordLocation {
  readonly runId: string;
  readonly traceId: string;
  readonly operation: string;
  readonly pluginId?: string;
  readonly contributionId?: string;
}

function bounded(value: string): string {
  return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT)}…`;
}

function exception(error: unknown, seen: WeakSet<object>, remaining: number): DebugException {
  if (!(error instanceof Error)) {
    return Object.freeze({ type: typeof error, message: bounded(String(error)) });
  }
  if (seen.has(error)) return Object.freeze({ type: error.name, message: '[circular cause]' });
  seen.add(error);
  const related =
    error instanceof AggregateError
      ? error.errors
      : error instanceof SuppressedError
        ? [error.error, error.suppressed]
        : error.cause === undefined
          ? []
          : [error.cause];
  const causes =
    remaining === 0
      ? []
      : related.slice(0, MAX_CAUSES).map((cause) => exception(cause, seen, remaining - 1));
  return Object.freeze({
    type: bounded(error.name),
    message: bounded(error.message),
    ...(error.stack === undefined ? {} : { stack: bounded(error.stack) }),
    ...(causes.length === 0 ? {} : { causes: Object.freeze(causes) }),
  });
}

/** @public */
export function captureDebugRecord(
  sink: DebugRecordSink | undefined,
  error: unknown,
  location: DebugRecordLocation,
): void {
  if (sink === undefined) return;
  const record = Object.freeze({
    id: randomUUID(),
    ...location,
    exception: exception(error, new WeakSet(), MAX_CAUSES),
  });
  try {
    sink.capture(record);
  } catch {
    // Debug capture is optional and cannot alter a Run.
  }
}

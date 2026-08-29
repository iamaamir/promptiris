import type { DebugRecord, DebugRecordSink, EventDispatcher } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import {
  definePlugin,
  type PluginImplementation,
  type PluginInvocation,
  type PluginRegistration,
} from '@promptiris/plugin-sdk';
import { createConsoleSink, JsonLinesSink, type EventSink } from './sinks.js';
import {
  createSupportBundle,
  MAX_BUNDLE_DEBUG_RECORDS,
  MAX_BUNDLE_EVENTS,
  type SupportBundle,
} from './support-bundle.js';

/** @public */
export interface ObserverDevtoolsOptions {
  readonly observerId?: string;
  readonly capacity?: number;
  readonly maxEvents?: number;
  readonly consoleSink?: EventSink | false;
  readonly jsonSink?: JsonLinesSink;
  readonly manifestIds?: readonly string[];
  readonly configTraceId?: string;
}

/** @public */
export interface ObserverDevtools extends DebugRecordSink {
  readonly observerId: string;
  readonly manifest: PluginRegistration['manifest'];
  readonly jsonSink: JsonLinesSink;
  attach(dispatcher: EventDispatcher): { detach(): Promise<void> };
  capture(record: DebugRecord): void;
  getEvents(): readonly Event[];
  getDebugRecords(): readonly DebugRecord[];
  createBundle(): SupportBundle;
  createRegistration(): PluginRegistration;
}

const DEFAULT_OBSERVER_ID = 'promptiris/observer-devtools';

function resolveObserverId(input?: string): string {
  const id = input ?? DEFAULT_OBSERVER_ID;
  if (typeof id !== 'string' || id.length === 0)
    throw new Error('observerId must be non-empty string');
  return id;
}

function resolveCapacity(input?: number): number {
  const v = input ?? 64;
  if (!Number.isSafeInteger(v) || v <= 0) throw new RangeError('capacity must be positive integer');
  return v;
}

function resolveMaxEvents(input?: number): number {
  const v = input ?? MAX_BUNDLE_EVENTS;
  if (!Number.isSafeInteger(v) || v <= 0)
    throw new RangeError('maxEvents must be positive integer');
  return v;
}

function makeRegistration(manifest: PluginRegistration['manifest']): PluginRegistration {
  return {
    manifest,
    activate(): PluginImplementation {
      return {
        async invoke(_request: PluginInvocation): Promise<Record<string, never>> {
          void _request;
          return {};
        },
      };
    },
  };
}

/** @public */
// eslint-disable-next-line max-lines-per-function
export function createObserverDevtools(options: ObserverDevtoolsOptions = {}): ObserverDevtools {
  const observerId = resolveObserverId(options.observerId);
  const capacity = resolveCapacity(options.capacity);
  const maxEvents = resolveMaxEvents(options.maxEvents);

  const consoleSink: EventSink | undefined =
    options.consoleSink === false ? undefined : (options.consoleSink ?? createConsoleSink());
  const jsonSink = options.jsonSink ?? new JsonLinesSink({ capacity: maxEvents });

  const events: Event[] = [];
  const debugRecords: DebugRecord[] = [];
  let runId: string | undefined;
  let traceId: string | undefined;

  function forwardToSinks(event: Event): void {
    try {
      consoleSink?.write(event);
    } catch {
      // sink failure isolated
    }
    try {
      jsonSink.write(event);
    } catch {
      // sink failure isolated
    }
  }

  function onEvent(event: Event): void {
    try {
      if (events.length < maxEvents) events.push(event);
      forwardToSinks(event);
      runId ??= event.runId;
      traceId ??= event.traceId;
    } catch {
      // bounded retention failure isolated
    }
  }

  const manifest = definePlugin({
    id: observerId,
    version: '0.1.0',
    type: 'observer',
    capabilities: [],
  });

  return {
    observerId,
    manifest,
    jsonSink,
    attach(dispatcher: EventDispatcher) {
      const subscription = dispatcher.subscribe({ observerId, capacity });
      let detached = false;
      void (async () => {
        try {
          for await (const event of subscription) {
            if (detached) break;
            onEvent(event);
          }
        } catch {
          // backpressure isolated
        }
      })();
      return {
        async detach(): Promise<void> {
          detached = true;
          try {
            await subscription.return();
          } catch {
            // detach isolated
          }
        },
      };
    },
    capture(record: DebugRecord): void {
      try {
        if (debugRecords.length < MAX_BUNDLE_DEBUG_RECORDS) debugRecords.push(record);
      } catch {
        // capture isolated
      }
    },
    getEvents(): readonly Event[] {
      return events;
    },
    getDebugRecords(): readonly DebugRecord[] {
      return debugRecords;
    },
    createBundle(): SupportBundle {
      return createSupportBundle({
        observerId,
        events: [...events],
        debugRecords: [...debugRecords],
        ...(options.manifestIds ? { manifestIds: options.manifestIds } : {}),
        ...(options.configTraceId ? { configTraceId: options.configTraceId } : {}),
        ...(runId ? { runId } : {}),
        ...(traceId ? { traceId } : {}),
      });
    },
    createRegistration(): PluginRegistration {
      return makeRegistration(manifest);
    },
  };
}

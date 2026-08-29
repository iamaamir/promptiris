import type { DebugRecord, DebugRecordSink, EventDispatcher } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import { definePlugin, type PluginImplementation, type PluginInvocation, type PluginRegistration } from '@promptiris/plugin-sdk';
import { createConsoleSink, JsonLinesSink, type EventSink } from './sinks.js';
import { createSupportBundle, MAX_BUNDLE_DEBUG_RECORDS, MAX_BUNDLE_EVENTS, type SupportBundle } from './support-bundle.js';

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

/** @public */
export function createObserverDevtools(options: ObserverDevtoolsOptions = {}): ObserverDevtools {
  const observerId = options.observerId ?? DEFAULT_OBSERVER_ID;
  if (typeof observerId !== 'string' || observerId.length === 0) throw new Error('observerId must be non-empty string');
  const capacity = options.capacity ?? 64;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be positive integer');
  const maxEvents = options.maxEvents ?? MAX_BUNDLE_EVENTS;
  if (!Number.isSafeInteger(maxEvents) || maxEvents <= 0) throw new RangeError('maxEvents must be positive integer');

  const consoleSink: EventSink | undefined =
    options.consoleSink === false ? undefined : (options.consoleSink ?? createConsoleSink());
  const jsonSink = options.jsonSink ?? new JsonLinesSink({ capacity: maxEvents });

  const events: Event[] = [];
  const debugRecords: DebugRecord[] = [];
  let runId: string | undefined;
  let traceId: string | undefined;

  function onEvent(event: Event): void {
    try {
      // Bounded retention
      if (events.length < maxEvents) events.push(event);
      // Always forward to sinks, sink failure isolated
      try {
        consoleSink?.write(event);
      } catch {}
      try {
        jsonSink.write(event);
      } catch {}
      if (runId === undefined) runId = event.runId;
      if (traceId === undefined) traceId = event.traceId;
    } catch {}
  }

  const manifest = definePlugin({
    id: observerId,
    version: '0.1.0',
    type: 'observer',
    capabilities: [],
  });

  function createRegistration(): PluginRegistration {
    return {
      manifest,
      activate(): PluginImplementation {
        return {
          async invoke(_request: PluginInvocation) {
            // Observer does not affect transformation outcome.
            return {};
          },
        };
      },
    };
  }

  return {
    observerId,
    manifest,
    jsonSink,
    attach(dispatcher: EventDispatcher) {
      const subscription = dispatcher.subscribe({ observerId, capacity });
      let detached = false;
      // Consume in background without blocking dispatcher; backpressure handled by dispatcher.
      (async () => {
        try {
          for await (const event of subscription) {
            if (detached) break;
            onEvent(event);
          }
        } catch {
          // Backpressure/detach isolates, cannot fail transformation
        }
      })();
      return {
        async detach() {
          detached = true;
          try {
            await subscription.return();
          } catch {}
        },
      };
    },
    capture(record: DebugRecord): void {
      try {
        if (debugRecords.length < MAX_BUNDLE_DEBUG_RECORDS) debugRecords.push(record);
      } catch {}
    },
    getEvents() {
      return events;
    },
    getDebugRecords() {
      return debugRecords;
    },
    createBundle(): SupportBundle {
      // Deterministic snapshot
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
    createRegistration,
  };
}

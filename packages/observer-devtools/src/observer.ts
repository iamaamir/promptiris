import type { DebugRecord, DebugRecordSink, EventDispatcher } from '@promptiris/core';
import type { Event } from '@promptiris/protocol';
import { definePlugin, type PluginRegistration } from '@promptiris/plugin-sdk';
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
  attach(dispatcher: EventDispatcher): { detach(): Promise<void>; done: Promise<void> };
  capture(record: DebugRecord): void;
  getEvents(): readonly Event[];
  getDebugRecords(): readonly DebugRecord[];
  createBundle(options?: { createdAt?: string }): SupportBundle;
}

function resolveObserverId(input?: string): string {
  const id = input ?? 'promptiris/observer-devtools';
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

function createSinks(
  opts: ObserverDevtoolsOptions,
  maxEvents: number,
): { consoleSink: EventSink | undefined; jsonSink: JsonLinesSink } {
  const consoleSink =
    opts.consoleSink === false ? undefined : (opts.consoleSink ?? createConsoleSink());
  const jsonSink = opts.jsonSink ?? new JsonLinesSink({ capacity: maxEvents });
  return { consoleSink, jsonSink };
}

interface DevtoolsState {
  readonly events: Event[];
  readonly debugRecords: DebugRecord[];
  runId: string | undefined;
  traceId: string | undefined;
}

function createState(): DevtoolsState {
  return { events: [], debugRecords: [], runId: undefined, traceId: undefined };
}

function forwardToSinks(
  event: Event,
  consoleSink: EventSink | undefined,
  jsonSink: JsonLinesSink,
): void {
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

function isTerminalEvent(event: Event): boolean {
  return /\.(?:failed|completed|cancelled)$/.test(event.type);
}

function onEvent(
  event: Event,
  state: DevtoolsState,
  maxEvents: number,
  consoleSink: EventSink | undefined,
  jsonSink: JsonLinesSink,
): void {
  try {
    if (state.events.length < maxEvents) state.events.push(event);
    else if (isTerminalEvent(event)) state.events.splice(0, 1, event);
    else {
      const progressIndex = state.events.findIndex((item) => item.delivery === 'progress');
      if (progressIndex >= 0) state.events.splice(progressIndex, 1, event);
    }
    forwardToSinks(event, consoleSink, jsonSink);
    state.runId ??= event.runId;
    state.traceId ??= event.traceId;
  } catch {
    // bounded retention failure isolated
  }
}

function attachToDispatcher(
  dispatcher: EventDispatcher,
  observerId: string,
  capacity: number,
  handler: (event: Event) => void,
): { detach(): Promise<void>; done: Promise<void> } {
  const subscription = dispatcher.subscribe({ observerId, capacity });
  let detached = false;
  const done = (async () => {
    try {
      for await (const event of subscription) {
        if (detached) break;
        handler(event);
      }
    } catch {
      // backpressure isolated
    }
  })();
  return {
    done,
    async detach(): Promise<void> {
      detached = true;
      try {
        await subscription.return();
      } catch {
        // detach isolated
      }
      await done;
    },
  };
}

interface BuildInput {
  readonly observerId: string;
  readonly capacity: number;
  readonly maxEvents: number;
  readonly consoleSink: EventSink | undefined;
  readonly jsonSink: JsonLinesSink;
  readonly manifest: PluginRegistration['manifest'];
  readonly state: DevtoolsState;
  readonly options: ObserverDevtoolsOptions;
}

function readEvents(state: DevtoolsState): readonly Event[] {
  return state.events;
}

function readDebugRecords(state: DevtoolsState): readonly DebugRecord[] {
  return state.debugRecords;
}

function buildDevtools(input: BuildInput): ObserverDevtools {
  const { observerId, capacity, maxEvents, consoleSink, jsonSink, manifest, state, options } =
    input;
  const handleEvent = (event: Event): void =>
    onEvent(event, state, maxEvents, consoleSink, jsonSink);
  let attached = false;
  return {
    observerId,
    manifest,
    jsonSink,
    attach(dispatcher: EventDispatcher) {
      if (attached) throw new Error('Observer devtools instance can attach only once');
      attached = true;
      return attachToDispatcher(dispatcher, observerId, capacity, handleEvent);
    },
    capture(record: DebugRecord): void {
      try {
        if (state.debugRecords.length < MAX_BUNDLE_DEBUG_RECORDS) state.debugRecords.push(record);
      } catch {
        // capture isolated
      }
    },
    getEvents: () => readEvents(state),
    getDebugRecords: () => readDebugRecords(state),
    createBundle(bundleOptions?: { createdAt?: string }): SupportBundle {
      return createSupportBundle({
        observerId,
        events: [...state.events],
        debugRecords: [...state.debugRecords],
        ...(options.manifestIds ? { manifestIds: options.manifestIds } : {}),
        ...(options.configTraceId ? { configTraceId: options.configTraceId } : {}),
        ...(state.runId ? { runId: state.runId } : {}),
        ...(state.traceId ? { traceId: state.traceId } : {}),
        ...(bundleOptions?.createdAt ? { createdAt: bundleOptions.createdAt } : {}),
      });
    },
  };
}

/** @public */
export function createObserverDevtools(options: ObserverDevtoolsOptions = {}): ObserverDevtools {
  const observerId = resolveObserverId(options.observerId);
  const capacity = resolveCapacity(options.capacity);
  const maxEvents = resolveMaxEvents(options.maxEvents);
  const { consoleSink, jsonSink } = createSinks(options, maxEvents);
  const state = createState();
  const manifest = definePlugin({
    id: observerId,
    version: '0.1.0',
    type: 'observer',
    capabilities: [],
  });
  return buildDevtools({
    observerId,
    capacity,
    maxEvents,
    consoleSink,
    jsonSink,
    manifest,
    state,
    options,
  });
}

import { randomUUID } from 'node:crypto';
import { createRunContext, identityRecipe } from '@promptiris/core';
import {
  validatePromptDocument,
  type Event,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type RunStartParams,
} from '@promptiris/protocol';

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const NOT_INITIALIZED = -32002;

export class RuntimeServer {
  #initialized = false;

  async handle(request: JsonRpcRequest): Promise<JsonRpcMessage[]> {
    switch (request.method) {
      case 'initialize':
        return [this.#initialize(request)];
      case 'run/start':
        return this.#run(request);
      case 'shutdown':
        return [this.#response(request, null)];
      default:
        return [this.#error(request, METHOD_NOT_FOUND, 'method not found')];
    }
  }

  #initialize(request: JsonRpcRequest): JsonRpcMessage {
    const params = request.params as { protocolVersion?: unknown } | undefined;
    if (params?.protocolVersion !== '1') {
      return this.#error(request, INVALID_PARAMS, 'unsupported protocol version');
    }
    this.#initialized = true;
    return this.#response(request, {
      protocolVersion: '1',
      serverName: 'promptiris-runtime',
      capabilities: {
        methods: ['initialize', 'run/start', 'shutdown'],
        events: [
          'promptiris.phase.started',
          'promptiris.phase.completed',
          'promptiris.run.completed',
        ],
      },
      limits: { maxFrameBytes: 8 * 1024 * 1024, maxDepth: 64 },
    });
  }

  async #run(request: JsonRpcRequest): Promise<JsonRpcMessage[]> {
    if (!this.#initialized) {
      return [this.#error(request, NOT_INITIALIZED, 'peer is not initialized')];
    }
    const params = request.params as RunStartParams | undefined;
    if (params?.recipe !== 'builtin.identity' || !validatePromptDocument(params.input)) {
      return [this.#error(request, INVALID_PARAMS, 'invalid identity run input')];
    }

    const runId = randomUUID();
    const messages: JsonRpcMessage[] = [];
    const context = createRunContext(runId, (event: Event) => {
      messages.push({ jsonrpc: '2.0', method: 'run/event', params: event });
    });
    const result = await identityRecipe.run(params.input, context);
    context.emit({
      type: 'promptiris.run.completed',
      source: 'core',
      dataSchema: 'promptiris/event/run-completed-v1',
      data: { status: result.status },
      classification: 'metadata',
      delivery: 'critical',
    });
    messages.push(this.#response(request, result));
    return messages;
  }

  #response(request: JsonRpcRequest, result: unknown): JsonRpcMessage {
    return { jsonrpc: '2.0', id: request.id, result };
  }

  #error(request: JsonRpcRequest, code: number, message: string): JsonRpcMessage {
    return { jsonrpc: '2.0', id: request.id, error: { code, message } };
  }
}

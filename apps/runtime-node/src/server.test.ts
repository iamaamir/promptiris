import { describe, expect, it } from 'vitest';
import { makeTextDocument, type JsonRpcRequest } from '@meta-prompt/protocol';
import { RuntimeServer } from './server.js';

function request(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

describe('runtime server', () => {
  it('requires initialization before running', async () => {
    const server = new RuntimeServer();

    const [response] = await server.handle(
      request(1, 'run/start', { recipe: 'builtin.identity', input: makeTextDocument('hello') }),
    );

    expect(response).toMatchObject({ error: { code: -32002 } });
  });

  it('runs identity with ordered lifecycle events followed by a result', async () => {
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));

    const messages = await server.handle(
      request(2, 'run/start', { recipe: 'builtin.identity', input: makeTextDocument('hello') }),
    );

    expect(messages.map((message) => ('method' in message ? message.method : 'response'))).toEqual([
      'run/event',
      'run/event',
      'run/event',
      'response',
    ]);
    expect(messages.at(-1)).toMatchObject({
      result: { status: 'success', primary: { value: 'hello' } },
    });
  });

  it('rejects an unknown recipe', async () => {
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));

    const [response] = await server.handle(
      request(2, 'run/start', { recipe: 'unknown', input: makeTextDocument('hello') }),
    );

    expect(response).toMatchObject({ error: { code: -32602 } });
  });

  it('rejects an unsupported protocol version', async () => {
    const server = new RuntimeServer();
    const [response] = await server.handle(request(1, 'initialize', { protocolVersion: 'future' }));
    expect(response).toMatchObject({ error: { code: -32602 } });
  });

  it('rejects malformed run input after initialization', async () => {
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));
    const [response] = await server.handle(
      request(2, 'run/start', { recipe: 'builtin.identity', input: { schemaVersion: '1' } }),
    );
    expect(response).toMatchObject({ error: { code: -32602 } });
  });

  it('supports shutdown and rejects unknown methods', async () => {
    const server = new RuntimeServer();
    expect(await server.handle(request(1, 'shutdown'))).toEqual([
      { jsonrpc: '2.0', id: 1, result: null },
    ]);
    expect(await server.handle(request(2, 'unknown'))).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32601, message: 'method not found' } },
    ]);
  });
});

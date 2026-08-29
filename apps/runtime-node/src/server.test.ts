import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  makeTextDocument,
  type DoctorResult,
  type Event,
  type InitializeResult,
  type InspectResult,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from '@promptiris/protocol';
import { RuntimeServer } from './server.js';

function request(id: number, method: string, params?: unknown): JsonRpcRequest {
  return { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
}

function resultOf(message: JsonRpcMessage | undefined): unknown {
  if (!message || !('result' in message)) throw new Error('expected JSON-RPC result');
  return (message as { readonly result: unknown }).result;
}

const temporaryDirectories: string[] = [];

async function configurationFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'promptiris-server-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'promptiris.jsonc');
  await writeFile(path, contents);
  return path;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe('runtime server', () => {
  it('requires initialization before running', async () => {
    const server = new RuntimeServer();

    const [response] = await server.handle(
      request(1, 'run/start', { recipe: 'builtin.identity', input: makeTextDocument('hello') }),
    );

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32002, message: 'peer is not initialized' },
    });
  });

  it.each(['inspect', 'doctor'])('requires initialization before %s', async (method) => {
    const [response] = await new RuntimeServer().handle(
      request(1, method, { configUri: '/not-read-before-initialize' }),
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
    expect(
      messages.slice(0, 3).map((message) =>
        'params' in message
          ? {
              type: (message.params as Event).type,
              source: (message.params as Event).source,
              dataSchema: (message.params as Event).dataSchema,
              classification: (message.params as Event).classification,
              delivery: (message.params as Event).delivery,
            }
          : undefined,
      ),
    ).toEqual([
      {
        type: 'promptiris.phase.started',
        source: 'core',
        dataSchema: 'promptiris/event/phase-started-v1',
        classification: 'metadata',
        delivery: 'critical',
      },
      {
        type: 'promptiris.phase.completed',
        source: 'core',
        dataSchema: 'promptiris/event/phase-completed-v1',
        classification: 'metadata',
        delivery: 'critical',
      },
      {
        type: 'promptiris.run.completed',
        source: 'core',
        dataSchema: 'promptiris/event/run-completed-v1',
        classification: 'metadata',
        delivery: 'critical',
      },
    ]);
  });

  it('rejects an unknown recipe', async () => {
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));

    const [response] = await server.handle(
      request(2, 'run/start', { recipe: 'unknown', input: makeTextDocument('hello') }),
    );

    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32602, message: 'invalid identity run input' },
    });
  });

  it('rejects an unsupported protocol version', async () => {
    const server = new RuntimeServer();
    const [response] = await server.handle(request(1, 'initialize', { protocolVersion: 'future' }));
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'unsupported protocol version' },
    });
  });

  it('advertises the exact initialized protocol surface', async () => {
    expect(
      await new RuntimeServer().handle(request(7, 'initialize', { protocolVersion: '1' })),
    ).toEqual([
      {
        jsonrpc: '2.0',
        id: 7,
        result: {
          protocolVersion: '1',
          serverName: 'promptiris-runtime',
          capabilities: {
            methods: ['initialize', 'run/start', 'inspect', 'doctor', 'shutdown'],
            events: [
              'promptiris.phase.started',
              'promptiris.phase.completed',
              'promptiris.run.completed',
            ],
          },
          limits: { maxFrameBytes: 8 * 1024 * 1024, maxDepth: 64 },
        },
      },
    ]);
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

  it('inspects configuration and reports a local-only doctor result', async () => {
    const path = await configurationFile(`{
      "provider": { "apiKey": { "ref": "env:PROMPTIRIS_API_KEY" } },
      "capabilities": [{
        "capability": "provider/json",
        "bindingFingerprint": "binding-a",
        "requirement": "required"
      }],
      "evidence": [{
        "evidenceId": "configured",
        "capability": "provider/json",
        "bindingFingerprint": "binding-a",
        "state": "supported",
        "source": { "kind": "configuration", "id": "fixture" }
      }]
    }`);
    const fetchSpy = vi.fn(() => Promise.reject(new Error('network must remain unused')));
    vi.stubGlobal('fetch', fetchSpy);
    const server = new RuntimeServer();
    const [initialized] = await server.handle(request(1, 'initialize', { protocolVersion: '1' }));
    const [inspection] = await server.handle(request(2, 'inspect', { configUri: path }));
    const [doctor] = await server.handle(request(3, 'doctor', { configUri: path }));

    const initializedResult = resultOf(initialized) as InitializeResult;
    const inspectionResult = resultOf(inspection) as InspectResult;
    const doctorResult = resultOf(doctor) as DoctorResult;
    expect(initializedResult.capabilities.methods).toContain('inspect');
    expect(initializedResult.capabilities.methods).toContain('doctor');
    expect(inspectionResult.redacted).toBe(true);
    expect(inspectionResult.config).toMatchObject({
      provider: { apiKey: { ref: 'env:PROMPTIRIS_API_KEY' } },
    });
    expect(inspectionResult.permissionHints.map(({ effect }) => effect)).toEqual([
      'network',
      'credential',
    ]);
    expect(inspectionResult.resolutions).toMatchObject([{ outcome: 'satisfied' }]);
    expect(doctorResult.ready).toBe(true);
    expect(doctorResult.checks).toEqual([
      { id: 'promptiris/runtime', status: 'passed' },
      { id: 'promptiris/config', status: 'passed' },
      { id: 'promptiris/capabilities', status: 'passed' },
      { id: 'promptiris/provider-connectivity', status: 'deferred' },
      { id: 'promptiris/provider-authentication', status: 'deferred' },
      { id: 'promptiris/provider-model-list', status: 'deferred' },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('inspects and diagnoses a missing required capability', async () => {
    const path = await configurationFile(`{
      "capabilities": [{
        "capability": "provider/json",
        "bindingFingerprint": "binding-a",
        "requirement": "required"
      }],
      "evidence": []
    }`);
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));

    const [inspection] = await server.handle(request(2, 'inspect', { configUri: path }));
    const [doctor] = await server.handle(request(3, 'doctor', { configUri: path }));

    expect(resultOf(inspection)).toMatchObject({
      resolutions: [
        {
          outcome: 'missing',
          diagnostic: { code: 'promptiris.capability.missing' },
        },
      ],
    });
    const doctorResult = resultOf(doctor) as DoctorResult;
    expect(doctorResult.ready).toBe(false);
    expect(doctorResult.diagnostics.map(({ code }) => code)).toEqual([
      'promptiris.capability.missing',
    ]);
    expect(doctorResult.checks).toContainEqual({
      id: 'promptiris/capabilities',
      status: 'failed',
    });
  });

  it('returns only a generic error for invalid or missing configuration', async () => {
    const path = await configurationFile(`{
      "provider": { "apiKey": "TOP_SECRET" },
      "capabilities": [],
      "evidence": []
    }`);
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));

    const responses = [
      await server.handle(request(2, 'inspect', { configUri: path })),
      await server.handle(request(3, 'doctor', { configUri: '/missing/config.jsonc' })),
    ];
    expect(responses).toEqual([
      [{ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'invalid configuration' } }],
      [{ jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'invalid configuration' } }],
    ]);
    expect(JSON.stringify(responses)).not.toContain('TOP_SECRET');
  });

  it.each([undefined, {}, { configUri: '' }, { configUri: 42 }])(
    'rejects invalid inspect parameters without filesystem access: %j',
    async (params) => {
      const server = new RuntimeServer();
      await server.handle(request(1, 'initialize', { protocolVersion: '1' }));
      expect(await server.handle(request(2, 'inspect', params))).toEqual([
        { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'invalid configuration' } },
      ]);
    },
  );

  it('rejects invalid doctor parameters without reading configuration', async () => {
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));
    expect(await server.handle(request(2, 'doctor', {}))).toEqual([
      { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'invalid configuration' } },
    ]);
  });

  it('keeps fallback and conflicts inspectable while doctor applies readiness rules', async () => {
    const preferred = await configurationFile(`{
      "capabilities": [{ "capability": "p/x", "bindingFingerprint": "b", "requirement": "preferred" }],
      "evidence": []
    }`);
    const conflict = await configurationFile(`{
      "capabilities": [{ "capability": "p/x", "bindingFingerprint": "b", "requirement": "optional" }],
      "evidence": [
        { "evidenceId": "yes", "capability": "p/x", "bindingFingerprint": "b", "state": "supported", "source": { "kind": "policy", "id": "yes" } },
        { "evidenceId": "no", "capability": "p/x", "bindingFingerprint": "b", "state": "unsupported", "source": { "kind": "policy", "id": "no" } }
      ]
    }`);
    const server = new RuntimeServer();
    await server.handle(request(1, 'initialize', { protocolVersion: '1' }));
    expect(await server.handle(request(2, 'inspect', { configUri: preferred }))).toMatchObject([
      { result: { resolutions: [{ outcome: 'fallback' }] } },
    ]);
    expect(await server.handle(request(3, 'inspect', { configUri: conflict }))).toMatchObject([
      {
        result: {
          resolutions: [
            {
              outcome: 'conflict',
              diagnostic: { code: 'promptiris.capability.evidence-conflict' },
            },
          ],
        },
      },
    ]);
    const [preferredDoctorMessage] = await server.handle(
      request(4, 'doctor', { configUri: preferred }),
    );
    const preferredDoctor = resultOf(preferredDoctorMessage) as DoctorResult;
    expect(preferredDoctor.ready).toBe(true);
    expect(preferredDoctor.diagnostics).toEqual([]);
    expect(preferredDoctor.checks).toContainEqual({
      id: 'promptiris/capabilities',
      status: 'passed',
    });
    const [conflictDoctorMessage] = await server.handle(
      request(5, 'doctor', { configUri: conflict }),
    );
    const conflictDoctor = resultOf(conflictDoctorMessage) as DoctorResult;
    expect(conflictDoctor.ready).toBe(false);
    expect(conflictDoctor.diagnostics).toMatchObject([
      { code: 'promptiris.capability.evidence-conflict' },
    ]);
    expect(conflictDoctor.checks).toContainEqual({
      id: 'promptiris/capabilities',
      status: 'failed',
    });
  });
});

import fs from 'node:fs';

const mode = process.argv[2] ?? 'happy';
const markerFile = process.argv[3];
let buffer = Buffer.alloc(0);

if (markerFile) fs.appendFileSync(markerFile, 'started\n');
if (mode === 'ignore-shutdown') {
  process.on('SIGTERM', () => {
    if (markerFile) fs.appendFileSync(markerFile, 'sigterm\n');
  });
}

function send(message) {
  const body = JSON.stringify(message);
  const frame = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
  process.stdout.write(frame);
}

function sendMalformed() {
  const body = '{native fixture malformed';
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`);
}

function initializeResult(requested) {
  if (mode === 'null-initialize-result') return null;
  const validMethods = ['plugin/invoke', 'plugin/cancel', 'plugin/shutdown'];
  const capabilities =
    mode === 'null-capabilities'
      ? null
      : mode === 'string-capabilities'
        ? 'invalid'
        : {
            methods: mode === 'invalid-methods' ? 'plugin/invoke' : validMethods,
            events: mode === 'invalid-events' ? {} : [],
          };
  const limits =
    mode === 'null-limits'
      ? null
      : mode === 'string-limits'
        ? 'invalid'
        : {
            maxFrameBytes:
              mode === 'zero-frame-limit'
                ? 0
                : mode === 'oversized-frame-limit'
                  ? 64 * 1024 * 1024
                  : mode === 'boundary-limits'
                    ? requested.maxFrameBytes
                    : Math.min(
                        1024 * 1024,
                        Number.isFinite(requested.maxFrameBytes)
                          ? requested.maxFrameBytes
                          : 1024 * 1024,
                      ),
            maxDepth:
              mode === 'zero-depth-limit'
                ? 0
                : mode === 'oversized-depth-limit'
                  ? 65
                  : mode === 'boundary-limits'
                    ? requested.maxDepth
                    : Math.min(32, Number.isFinite(requested.maxDepth) ? requested.maxDepth : 32),
          };
  return {
    protocolVersion: mode === 'wrong-initialize' ? '2' : '1',
    pluginName: 'native-fixture',
    capabilities,
    limits,
  };
}

function handle(message) {
  if (!message || typeof message.method !== 'string') return;
  if ((mode === 'trace' || mode === 'trace-hang') && markerFile) {
    fs.appendFileSync(markerFile, `${JSON.stringify(message)}\n`);
  }
  if (message.method === 'initialize') {
    if (mode === 'hang-initialize') return;
    const requested = message.params?.limits ?? {};
    send({
      jsonrpc: mode === 'wrong-jsonrpc-initialize' ? '1.0' : '2.0',
      id: message.id,
      result: initializeResult(requested),
    });
    return;
  }
  if (message.method === 'plugin/invoke') {
    if (mode === 'malformed') return sendMalformed();
    if (mode === 'rpc-error')
      return send({ jsonrpc: '2.0', id: message.id, error: { code: -32_000, message: 'fixture' } });
    if (mode === 'error-and-result')
      return send({
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32_000, message: 'fixture' },
        result: null,
      });
    if (mode === 'missing-result') return send({ jsonrpc: '2.0', id: message.id });
    if (mode === 'wrong-id-invoke')
      return send({ jsonrpc: '2.0', id: message.id + 1, result: null });
    if (mode === 'crash') {
      process.stderr.write('secret fixture stderr\n');
      process.exit(7);
    }
    if (mode === 'hang' || mode === 'trace-hang') return;
    const input = message.params?.input;
    const document = {
      ...input,
      content: [
        ...(input?.content ?? []),
        {
          id: 'native',
          text:
            mode === 'environment' ? (process.env.META_PROMPT_TEST_VALUE ?? 'missing') : 'native',
        },
      ],
    };
    const response = {
      jsonrpc: mode === 'wrong-jsonrpc-invoke' ? '1.0' : '2.0',
      id: message.id,
      result: document,
    };
    if (mode === 'stderr-flood') {
      let remainingChunks = 128;
      const flood = () => {
        while (remainingChunks > 0) {
          remainingChunks -= 1;
          if (!process.stderr.write(Buffer.alloc(64 * 1024, 'x'))) {
            process.stderr.once('drain', flood);
            return;
          }
        }
        send(response);
      };
      flood();
      return;
    }
    if (mode === 'late-success') setTimeout(() => send(response), 25);
    else send(response);
    return;
  }
  if (message.method === 'plugin/cancel') {
    if ((mode === 'hang' || mode === 'trace-hang') && markerFile) {
      fs.appendFileSync(markerFile, 'cancelled\n');
    }
    return;
  }
  if (message.method === 'plugin/shutdown') {
    if (mode === 'ignore-shutdown') return;
    if (mode === 'malformed-shutdown') return sendMalformed();
    send({ jsonrpc: '2.0', id: message.id, result: null });
    if (mode === 'linger-after-shutdown') return;
    process.stdout.once('drain', () => process.exit(0));
    setImmediate(() => process.exit(0));
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator < 0) return;
    const headers = buffer.subarray(0, separator).toString('ascii');
    const match = headers.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
    if (!match) return;
    const length = Number(match[1]);
    const end = separator + 4 + length;
    if (buffer.length < end) return;
    const body = buffer.subarray(separator + 4, end).toString('utf8');
    buffer = buffer.subarray(end);
    try {
      handle(JSON.parse(body));
    } catch {
      // Malformed host input is ignored by this test fixture.
    }
  }
});

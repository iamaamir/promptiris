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

function handle(message) {
  if (!message || typeof message.method !== 'string') return;
  if (message.method === 'initialize') {
    const requested = message.params?.limits ?? {};
    send({
      jsonrpc: mode === 'wrong-jsonrpc-initialize' ? '1.0' : '2.0',
      id: message.id,
      result: {
        protocolVersion: mode === 'wrong-initialize' ? '2' : '1',
        pluginName: 'native-fixture',
        capabilities: {
          methods: ['plugin/invoke', 'plugin/cancel', 'plugin/shutdown'],
          events: [],
        },
        limits: {
          maxFrameBytes: Math.min(
            1024 * 1024,
            Number.isFinite(requested.maxFrameBytes) ? requested.maxFrameBytes : 1024 * 1024,
          ),
          maxDepth: Math.min(32, Number.isFinite(requested.maxDepth) ? requested.maxDepth : 32),
        },
      },
    });
    return;
  }
  if (message.method === 'plugin/invoke') {
    if (mode === 'malformed') return sendMalformed();
    if (mode === 'crash') {
      process.stderr.write('secret fixture stderr\n');
      process.exit(7);
    }
    if (mode === 'hang') return;
    const input = message.params?.input;
    const document = {
      ...input,
      content: [...(input?.content ?? []), { id: 'native', text: 'native' }],
    };
    const response = {
      jsonrpc: mode === 'wrong-jsonrpc-invoke' ? '1.0' : '2.0',
      id: message.id,
      result: document,
    };
    if (mode === 'late-success') setTimeout(() => send(response), 25);
    else send(response);
    return;
  }
  if (message.method === 'plugin/cancel') {
    if (mode === 'hang' && markerFile) fs.appendFileSync(markerFile, 'cancelled\n');
    return;
  }
  if (message.method === 'plugin/shutdown') {
    if (mode === 'ignore-shutdown') return;
    if (mode === 'malformed-shutdown') return sendMalformed();
    send({ jsonrpc: '2.0', id: message.id, result: null });
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

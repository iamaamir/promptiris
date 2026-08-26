#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const [operation, fileArg, lineArg = '0', characterArg = '0'] = process.argv.slice(2);
if (!operation || !fileArg) {
  console.error('usage: lsp-query <definition|references|symbols> FILE [LINE] [CHARACTER]');
  process.exit(64);
}
const file = resolve(fileArg);
const language = ['.go'].includes(extname(file)) ? 'go' : 'typescript';
const localGopls = resolve('.tools/bin/gopls');
const command =
  language === 'go'
    ? existsSync(localGopls)
      ? localGopls
      : 'gopls'
    : resolve('node_modules/.bin/typescript-language-server');
const args = language === 'go' ? ['serve'] : ['--stdio'];
const cacheDirectory = resolve('.agent/indexes');
await mkdir(cacheDirectory, { recursive: true });
const child = spawn(command, args, {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: {
    ...process.env,
    GOCACHE: resolve(cacheDirectory, 'go-build'),
    GOPLSCACHE: resolve(cacheDirectory, 'gopls'),
  },
});
let buffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map();

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]));
}
function request(method, params) {
  const id = nextId++;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolveResult, reject) => pending.set(id, { resolve: resolveResult, reject }));
}
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator < 0) return;
    const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, separator).toString('ascii'));
    if (!match) throw new Error('LSP response omitted Content-Length');
    const length = Number(match[1]);
    const start = separator + 4;
    if (buffer.length < start + length) return;
    const message = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
    buffer = buffer.subarray(start + length);
    if (message.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
    }
  }
});

const root = language === 'go' ? resolve(file, '..') : resolve('.');
const uri = pathToFileURL(file).href;
const text = await readFile(file, 'utf8');
const position = { line: Number(lineArg), character: Number(characterArg) };
const methods = { definition: 'textDocument/definition', references: 'textDocument/references', symbols: 'textDocument/documentSymbol' };
if (!methods[operation]) throw new Error(`unsupported LSP operation: ${operation}`);

const timeout = setTimeout(() => child.kill(), 15_000);
try {
  await request('initialize', { processId: process.pid, rootUri: pathToFileURL(root).href, capabilities: {} });
  send({ jsonrpc: '2.0', method: 'initialized', params: {} });
  send({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: language, version: 1, text } } });
  const params = operation === 'symbols' ? { textDocument: { uri } } : { textDocument: { uri }, position, ...(operation === 'references' ? { context: { includeDeclaration: true } } : {}) };
  const result = await request(methods[operation], params);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, provider: language === 'go' ? 'gopls' : 'typescript-language-server', operation, result }, null, 2)}\n`);
  await request('shutdown', null);
  send({ jsonrpc: '2.0', method: 'exit' });
} finally {
  clearTimeout(timeout);
  child.kill();
}

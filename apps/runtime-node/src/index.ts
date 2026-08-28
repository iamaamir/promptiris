#!/usr/bin/env node
import {
  ContentLengthDecoder,
  encodeMessage,
  type JsonRpcMessage,
  type JsonRpcRequest,
} from '@promptiris/protocol';
import { RuntimeServer } from './server.js';

const decoder = new ContentLengthDecoder();
const server = new RuntimeServer();
let processing = Promise.resolve();

function write(message: JsonRpcMessage): void {
  process.stdout.write(encodeMessage(message));
}

function handle(request: JsonRpcRequest): void {
  processing = processing.then(async () => {
    const messages = await server.handle(request);
    for (const message of messages) write(message);
  });
  processing.catch((error: unknown) => {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}

process.stdin.on('data', (chunk: Buffer) => {
  try {
    for (const message of decoder.push(chunk)) {
      if ('method' in message && 'id' in message) handle(message);
    }
  } catch (error) {
    process.stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  }
});

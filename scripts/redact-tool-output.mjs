#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  process.stderr.write('usage: redact-tool-output INPUT OUTPUT\n');
  process.exit(64);
}

const patterns = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g,
  /\bnpm_[A-Za-z0-9]{12,}\b/g,
  /((?:api[_-]?key|access[_-]?token|auth(?:orization)?|client[_-]?secret|password|private[_-]?key|secret|token)["']?\s*[:=]\s*["']?)([^\s,"']+)/gi,
];

let contents = await readFile(input, 'utf8');
let count = 0;
for (const pattern of patterns) {
  contents = contents.replace(pattern, (...parts) => {
    count += 1;
    const prefix = parts[1];
    return prefix && pattern === patterns.at(-1) ? `${prefix}[REDACTED]` : '[REDACTED]';
  });
}
await writeFile(output, contents, { mode: 0o600 });
process.stdout.write(String(count));

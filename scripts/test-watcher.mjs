import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = await mkdtemp(join(tmpdir(), 'meta-prompt-watcher-'));
const source = join(directory, 'change.ts');
let diagnostics = '';
let events = '';
await writeFile(source, 'export const value = 1;\n');

const watcher = spawn(
  'watchexec',
  [
    '--only-emit-events',
    '--emit-events-to',
    'stdio',
    '--ignore-nothing',
    '--debounce',
    '50ms',
    '--poll',
    '100ms',
    '--watch',
    directory,
    '--project-origin',
    directory,
    '--exts',
    'ts',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
watcher.stdout.setEncoding('utf8');
watcher.stdout.on('data', (chunk) => {
  events += chunk;
});
watcher.stderr.setEncoding('utf8');
watcher.stderr.on('data', (chunk) => {
  diagnostics += chunk;
});

try {
  await delay(2_000);
  await writeFile(source, 'export const value = 2;\n');
  let observed = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    observed = events.includes('change.ts');
    if (observed) break;
    await delay(50);
  }
  if (!observed) {
    throw new Error(
      `watchexec did not deliver the filesystem event (exit ${String(watcher.exitCode)}): ${diagnostics}`,
    );
  }
  process.stdout.write('watchexec observed one bounded source-change event\n');
} finally {
  watcher.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => watcher.once('exit', resolve)),
    delay(2_000).then(() => watcher.kill('SIGKILL')),
  ]);
  await rm(directory, { recursive: true, force: true });
}

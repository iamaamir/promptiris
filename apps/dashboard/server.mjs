#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeTelemetry } from '../../tooling/telemetry/analyze.mjs';

const dashboardRoot = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(dashboardRoot, 'public');
const repositoryRoot = join(dashboardRoot, '..', '..');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const sendJson = (response, status, body) => {
  response.writeHead(status, {
    ...securityHeaders,
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(`${JSON.stringify(body)}\n`);
};

export const handleDashboardRequest = async (request, response, root = repositoryRoot) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (url.pathname === '/api/telemetry') {
    const report = await analyzeTelemetry({ root });
    if (request.method === 'HEAD') {
      response.writeHead(200, {
        ...securityHeaders,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end();
    } else {
      sendJson(response, 200, report);
    }
    return;
  }
  const asset = assets.get(url.pathname);
  if (!asset) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  const [file, contentType] = asset;
  const body = await readFile(join(publicRoot, file));
  response.writeHead(200, {
    ...securityHeaders,
    'Cache-Control': 'no-cache',
    'Content-Type': contentType,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
};

export const createDashboardServer = (options = {}) => {
  const root = options.root ?? repositoryRoot;
  return createServer((request, response) => {
    handleDashboardRequest(request, response, root).catch((error) => {
      sendJson(response, 500, {
        error: 'telemetry_unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
    });
  });
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const host = '127.0.0.1';
  const port = Number(process.env.META_PROMPT_DASHBOARD_PORT ?? 4173);
  createDashboardServer().listen(port, host, () => {
    process.stdout.write(`Meta Prompt evidence dashboard: http://${host}:${port}\n`);
  });
}

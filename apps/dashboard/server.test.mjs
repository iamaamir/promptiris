import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleDashboardRequest } from './server.mjs';

const request = async (url, method = 'GET') => {
  const result = { body: '', headers: {}, status: 0 };
  const response = {
    writeHead(status, headers) {
      result.status = status;
      result.headers = headers;
    },
    end(body = '') {
      result.body = Buffer.isBuffer(body) ? body.toString('utf8') : body;
    },
  };
  await handleDashboardRequest({ method, url }, response);
  return result;
};

test('serves the dashboard with restrictive security headers', async () => {
  const response = await request('/');
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Security-Policy'], /default-src 'self'/);
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(response.body, /Meta Prompt Evidence/);
});

test('serves generated telemetry without caching', async () => {
  const response = await request('/api/telemetry');
  assert.equal(response.status, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const report = JSON.parse(response.body);
  assert.equal(report.schemaVersion, 1);
  assert.ok(report.summary.traceCount >= 0);
  assert.equal(report.quality.mutation.policy.available, true);
  assert.ok(Array.isArray(report.quality.mutation.targets));
  assert.ok(report.usage.inventory.some((provider) => provider.id === 'codeql'));
  assert.ok(report.usage.inventory.some((provider) => provider.id === 'scripts/lsp-query.mjs'));
});

test('rejects unknown paths and mutating methods', async () => {
  assert.equal((await request('/package.json')).status, 404);
  assert.equal((await request('/', 'POST')).status, 405);
});

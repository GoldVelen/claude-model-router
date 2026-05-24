import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { createServer } from '../../src/server.js';
import { resetStats, recordRequest } from '../../src/stats/stats-store.js';

function get(url: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${url}`, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

describe('GET /stats', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    resetStats();
    server = createServer();
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    server.close();
  });

  it('returns 200 with JSON stats', async () => {
    recordRequest('claude');
    recordRequest('deepseek');
    const { status, body } = await get('/stats', port);
    assert.strictEqual(status, 200);
    const data = JSON.parse(body);
    assert.strictEqual(data.total, 2);
    assert.strictEqual(data.backends['claude'].count, 1);
    assert.strictEqual(data.backends['deepseek'].count, 1);
  });

  it('returns empty stats when no requests recorded', async () => {
    const { status, body } = await get('/stats', port);
    assert.strictEqual(status, 200);
    const data = JSON.parse(body);
    assert.strictEqual(data.total, 0);
    assert.deepStrictEqual(data.backends, {});
  });

  it('includes uptime and startTime fields', async () => {
    const { status, body } = await get('/stats', port);
    assert.strictEqual(status, 200);
    const data = JSON.parse(body);
    assert.ok(typeof data.uptime === 'number');
    assert.ok(typeof data.startTime === 'string');
  });

  it('returns 404 for non-POST non-GET requests to other paths', async () => {
    const { status } = await get('/v1/messages', port);
    assert.strictEqual(status, 404);
  });

  afterEach(() => {
    server.close();
  });
});

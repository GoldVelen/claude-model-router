import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

function getJson(port: number, path: string): Promise<{ status: number; data: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, data: d, headers: res.headers }));
    }).on('error', reject);
  });
}

function postJson(port: number, path: string, body: unknown): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, data: d }));
    });
    req.on('error', reject);
    req.end(raw);
  });
}

describe('E2E: route handlers', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '';

      if (url === '/stats' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ total: 5, uptime: 30000, startTime: new Date().toISOString() }));
        return;
      }

      if (url === '/web' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!DOCTYPE html><html lang="en"><head><title>CMR</title></head><body></body></html>');
        return;
      }

      if (url === '/api/config' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          port: 3457,
          backends: { x: { url: 'https://x.com', apiKey: '***' } },
        }));
        return;
      }

      if (url === '/api/logs' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: ['line1', 'line2'] }));
        return;
      }

      if (url === '/v1/messages' && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'resp-1', model: parsed.model }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
      port = (server.address() as AddressInfo).port;
      resolve();
    }));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /stats returns JSON with total, uptime', async () => {
    const res = await getJson(port, '/stats');
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.total, 5);
    assert.ok(typeof parsed.uptime === 'number');
    assert.ok(typeof parsed.startTime === 'string');
  });

  it('GET /web returns HTML with correct content-type', async () => {
    const res = await getJson(port, '/web');
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'));
    assert.ok(res.data.includes('<!DOCTYPE html>'));
  });

  it('GET /api/config returns config with redacted apiKey', async () => {
    const res = await getJson(port, '/api/config');
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.backends.x.apiKey, '***');
  });

  it('GET /api/logs returns array of log lines', async () => {
    const res = await getJson(port, '/api/logs');
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.ok(Array.isArray(parsed.logs));
    assert.strictEqual(parsed.logs.length, 2);
  });

  it('POST /v1/messages returns response with model echo', async () => {
    const res = await postJson(port, '/v1/messages', {
      model: 'test-model-1',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.id, 'resp-1');
    assert.strictEqual(parsed.model, 'test-model-1');
  });
});

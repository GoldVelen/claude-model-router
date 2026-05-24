import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { resetStats, getSnapshot, recordRequest, recordFailure, isDegraded } from '../src/stats/stats-store.js';
import { selectBackends } from '../src/router.js';
import { type BackendConfig } from '../src/types.js';

function startMockBackend(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        server.close();
        throw new Error('Failed to get server address');
      }
      resolve({ server, port: addr.port });
    });
  });
}

function makeProxyRequest(
  port: number,
  body: Record<string, unknown>,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const raw = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, data }));
      },
    );
    req.on('error', reject);
    req.end(raw);
  });
}

function libRequest(
  backend: BackendConfig,
  path: string,
  body: string,
  cb: (result: { ok: boolean; err?: string }) => void,
): void {
  const url = new URL(backend.url);
  const req = http.request(
    {
      hostname: url.hostname,
      port: url.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          cb({ ok: false, err: `HTTP ${res.statusCode}` });
        } else {
          cb({ ok: true });
        }
      });
    },
  );
  req.on('error', (err) => cb({ ok: false, err: err.message }));
  req.end(body);
}

describe('Stats store: degraded tracking', () => {
  beforeEach(() => resetStats());
  afterEach(() => resetStats());

  it('isDegraded returns false when failures < 3', () => {
    recordFailure('test', 'HTTP 500');
    recordFailure('test', 'HTTP 500');
    assert.strictEqual(isDegraded('test'), false);
  });

  it('isDegraded returns true after 3 consecutive failures', () => {
    recordFailure('test', 'error 1');
    recordFailure('test', 'error 2');
    recordFailure('test', 'error 3');
    assert.strictEqual(isDegraded('test'), true);
  });

  it('consecutiveFailures resets to 0 after a successful request', () => {
    recordFailure('test', 'error 1');
    recordFailure('test', 'error 2');
    assert.strictEqual(getSnapshot().backends['test']?.consecutiveFailures, 2);

    recordRequest('test');
    const snap = getSnapshot();
    assert.strictEqual(snap.backends['test']?.consecutiveFailures, 0);
    assert.strictEqual(isDegraded('test'), false);
  });

  it('consecutiveFailures accumulate beyond 3', () => {
    recordFailure('test', 'e1');
    recordFailure('test', 'e2');
    recordFailure('test', 'e3');
    recordFailure('test', 'e4');
    recordFailure('test', 'e5');
    const snap = getSnapshot();
    assert.strictEqual(snap.backends['test']?.consecutiveFailures, 5);
    assert.strictEqual(snap.backends['test']?.failures, 5);
  });

  it('isDegraded returns false for unknown backend', () => {
    assert.strictEqual(isDegraded('nonexistent'), false);
  });
});

describe('Router: selectBackends filters degraded', () => {
  const good: BackendConfig = {
    url: 'https://good.example.com',
    apiKey: 'k1',
    modelPattern: '^good-',
  };
  const bad: BackendConfig = {
    url: 'https://bad.example.com',
    apiKey: 'k2',
    modelPattern: '^bad-',
  };

  beforeEach(() => resetStats());
  afterEach(() => resetStats());

  it('returns all matching backends when none degraded', () => {
    const backends = { good, bad };
    const result = selectBackends('good-model', backends);
    assert.strictEqual(result.length, 2);
  });

  it('filters out degraded backend', () => {
    recordFailure('bad', 'e1');
    recordFailure('bad', 'e2');
    recordFailure('bad', 'e3');

    const backends = { good, bad };
    const result = selectBackends('good-model', backends);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.url, 'https://good.example.com');
  });

  it('returns empty array when all backends degraded', () => {
    recordFailure('good', 'e1');
    recordFailure('good', 'e2');
    recordFailure('good', 'e3');
    recordFailure('bad', 'e1');
    recordFailure('bad', 'e2');
    recordFailure('bad', 'e3');

    const backends = { good, bad };
    const result = selectBackends('test-model', backends);
    assert.strictEqual(result.length, 0);
  });
});

describe('Server: auto fallback retry loop', () => {
  beforeEach(() => resetStats());
  afterEach(() => resetStats());

  it('falls back to second backend when first returns 500', async () => {
    const goodBackend = await startMockBackend((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'ok', content: [{ type: 'text', text: 'good' }] }));
    });

    const badBackend = await startMockBackend((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'internal error' } }));
    });

    const proxy = await startMockBackend(async (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      await new Promise<void>((resolve) => req.on('end', resolve));

      const parsed = JSON.parse(body) as { model?: string };
      const backends: [string, BackendConfig][] = [
        ['bad', { url: `http://127.0.0.1:${badBackend.port}`, apiKey: '', path: '/', modelPattern: '^test-' }],
        ['good', { url: `http://127.0.0.1:${goodBackend.port}`, apiKey: '', path: '/', modelPattern: '^test-' }],
      ];

      const errors: string[] = [];
      for (const [name, backend] of backends) {
        const result = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
          libRequest(backend, '/', body, resolve);
        });

        if (result.ok) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'from-good' }));
          return;
        }

        recordFailure(name, result.err ?? 'unknown');
        errors.push(`[${name}] ${result.err ?? 'unknown'}`);
      }

      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: 'All backends exhausted', details: errors.join('; ') },
      }));
    });

    try {
      const res = await makeProxyRequest(proxy.port, { model: 'test-model', max_tokens: 10 });
      assert.strictEqual(res.status, 200);
      const parsed = JSON.parse(res.data);
      assert.strictEqual(parsed.id, 'from-good');
    } finally {
      goodBackend.server.close();
      badBackend.server.close();
      proxy.server.close();
    }
  });

  it('returns 502 when all backends exhausted', async () => {
    const bad1 = await startMockBackend((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'down' }));
    });

    const bad2 = await startMockBackend((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'also down' }));
    });

    const proxy = await startMockBackend(async (req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      await new Promise<void>((resolve) => req.on('end', resolve));

      const backends: [string, BackendConfig][] = [
        ['b1', { url: `http://127.0.0.1:${bad1.port}`, apiKey: '', path: '/', modelPattern: '^test-' }],
        ['b2', { url: `http://127.0.0.1:${bad2.port}`, apiKey: '', path: '/', modelPattern: '^test-' }],
      ];

      const errors: string[] = [];
      for (const [name, backend] of backends) {
        const result = await new Promise<{ ok: boolean; err?: string }>((resolve) => {
          libRequest(backend, '/', body, resolve);
        });
        if (result.ok) {
          res.writeHead(200);
          res.end('ok');
          return;
        }
        errors.push(`[${name}] ${result.err ?? ''}`);
      }

      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { message: 'All backends exhausted', details: errors.join('; ') },
      }));
    });

    try {
      const res = await makeProxyRequest(proxy.port, { model: 'test-model' });
      assert.strictEqual(res.status, 502);
      const parsed = JSON.parse(res.data);
      assert.ok(parsed.error.message.includes('exhausted'));
    } finally {
      bad1.server.close();
      bad2.server.close();
      proxy.server.close();
    }
  });
});

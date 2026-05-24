import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';

describe('checkBackends', () => {
  it('returns results for all configured backends', async () => {
    const { checkBackends } = await import('../../src/commands/health.js');

    const server1 = http.createServer((_req, res) => { res.writeHead(200); res.end(); });
    const server2 = http.createServer((_req, res) => { res.writeHead(200); res.end(); });

    await Promise.all([
      new Promise<void>((r) => server1.listen(0, r)),
      new Promise<void>((r) => server2.listen(0, r)),
    ]);

    const port1 = (server1.address() as { port: number }).port;
    const port2 = (server2.address() as { port: number }).port;

    const backends = {
      a: { url: `http://127.0.0.1:${port1}`, apiKey: '' },
      b: { url: `http://127.0.0.1:${port2}`, apiKey: '' },
    };

    const results = await checkBackends(backends);
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0]?.reachable, true);
    assert.strictEqual(results[1]?.reachable, true);

    server1.close();
    server2.close();
  });

  it('detects unreachable backends', async () => {
    const { checkBackends } = await import('../../src/commands/health.js');
    const backends = {
      bad: { url: 'http://127.0.0.1:19999', apiKey: '' },
    };
    const results = await checkBackends(backends);
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0]?.reachable, false);
    assert.ok(results[0]?.error);
  });
});

describe('runHealthCheck', () => {
  it('returns 0 when all backends healthy', async () => {
    const { runHealthCheck } = await import('../../src/commands/health.js');

    const server = http.createServer((_req, res) => { res.writeHead(200); res.end(); });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;

    const code = await runHealthCheck({ ok: { url: `http://127.0.0.1:${port}`, apiKey: '' } });
    assert.strictEqual(code, 0);

    server.close();
  });

  it('returns 1 when any backend is unreachable', async () => {
    const { runHealthCheck } = await import('../../src/commands/health.js');
    const code = await runHealthCheck({ bad: { url: 'http://127.0.0.1:19999', apiKey: '' } });
    assert.strictEqual(code, 1);
  });
});

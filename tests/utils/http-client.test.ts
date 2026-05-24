import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('checkBackend', () => {
  it('returns reachable=true for a valid HTTP server', async () => {
    const http = await import('node:http');
    const { checkBackend } = await import('../../src/utils/http-client.js');

    const server = http.createServer((_req, res) => {
      res.writeHead(200);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const result = await checkBackend('test', `http://127.0.0.1:${port}`);
    assert.strictEqual(result.name, 'test');
    assert.strictEqual(result.reachable, true);
    assert.strictEqual(result.error, null);

    server.close();
  });

  it('returns reachable=false for a non-existent server', async () => {
    const { checkBackend } = await import('../../src/utils/http-client.js');
    const result = await checkBackend('bad', 'http://127.0.0.1:19999', 1000);
    assert.strictEqual(result.reachable, false);
    assert.ok(result.error);
  });

  it('respects the timeout parameter', async () => {
    const http = await import('node:http');
    const { checkBackend } = await import('../../src/utils/http-client.js');

    const server = http.createServer((_req, res) => {
      setTimeout(() => { res.writeHead(200); res.end(); }, 3000);
    });

    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;

    const start = Date.now();
    const result = await checkBackend('slow', `http://127.0.0.1:${port}`, 500);
    const elapsed = Date.now() - start;

    assert.strictEqual(result.reachable, false);
    assert.ok(elapsed < 2000);

    server.close();
  });
});

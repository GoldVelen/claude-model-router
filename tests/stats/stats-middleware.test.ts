import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { type ServerResponse } from 'node:http';
import { Writable } from 'node:stream';

function mockRes(): ServerResponse {
  const res = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  }) as unknown as ServerResponse;
  res.statusCode = 200;
  res.writeHead = (_statusCode: number, _headers?: Record<string, string>) => res;
  res.end = (() => {}) as unknown as ServerResponse['end'];
  return res;
}

describe('statsMiddleware', () => {
  beforeEach(async () => {
    const { resetStats } = await import('../../src/stats/stats-store.js');
    resetStats();
  });

  it('records a request when res.end is called', async () => {
    const { statsMiddleware } = await import('../../src/stats/stats-middleware.js');
    const { getSnapshot } = await import('../../src/stats/stats-store.js');

    const req = new EventEmitter() as unknown as Parameters<typeof statsMiddleware>[0];
    const res = mockRes();
    statsMiddleware(req, res, 'claude');

    res.end();

    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 1);
    assert.strictEqual(snapshot.backends['claude']?.count, 1);
  });

  it('records separate counts for different backends', async () => {
    const { statsMiddleware } = await import('../../src/stats/stats-middleware.js');
    const { getSnapshot } = await import('../../src/stats/stats-store.js');

    const req1 = new EventEmitter() as unknown as Parameters<typeof statsMiddleware>[0];
    const req2 = new EventEmitter() as unknown as Parameters<typeof statsMiddleware>[0];
    const res1 = mockRes();
    const res2 = mockRes();

    statsMiddleware(req1, res1, 'claude');
    statsMiddleware(req2, res2, 'deepseek');

    res1.end();
    res2.end();

    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 2);
    assert.strictEqual(snapshot.backends['claude']?.count, 1);
    assert.strictEqual(snapshot.backends['deepseek']?.count, 1);
  });
});

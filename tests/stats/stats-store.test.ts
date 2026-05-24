import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('stats-store', () => {
  beforeEach(async () => {
    const { resetStats } = await import('../../src/stats/stats-store.js');
    resetStats();
  });

  it('starts with zero total and empty backends', async () => {
    const { getSnapshot } = await import('../../src/stats/stats-store.js');
    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 0);
    assert.deepStrictEqual(snapshot.backends, {});
    assert.ok(snapshot.startTime);
    assert.ok(typeof snapshot.uptime === 'number');
  });

  it('records a single request for a backend', async () => {
    const { recordRequest, getSnapshot } = await import('../../src/stats/stats-store.js');
    recordRequest('claude');
    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 1);
    assert.strictEqual(snapshot.backends['claude']?.count, 1);
    assert.ok(snapshot.backends['claude']?.lastRequest);
  });

  it('records multiple requests for multiple backends', async () => {
    const { recordRequest, getSnapshot } = await import('../../src/stats/stats-store.js');
    recordRequest('claude');
    recordRequest('claude');
    recordRequest('deepseek');
    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 3);
    assert.strictEqual(snapshot.backends['claude']?.count, 2);
    assert.strictEqual(snapshot.backends['deepseek']?.count, 1);
  });

  it('getSnapshot returns an immutable copy', async () => {
    const { recordRequest, getSnapshot } = await import('../../src/stats/stats-store.js');
    recordRequest('claude');
    const snapshot1 = getSnapshot();
    recordRequest('claude');
    const snapshot2 = getSnapshot();
    assert.strictEqual(snapshot1.total, 1);
    assert.strictEqual(snapshot2.total, 2);
  });

  it('reset clears all data', async () => {
    const { recordRequest, getSnapshot, resetStats } = await import('../../src/stats/stats-store.js');
    recordRequest('claude');
    recordRequest('deepseek');
    resetStats();
    const snapshot = getSnapshot();
    assert.strictEqual(snapshot.total, 0);
    assert.deepStrictEqual(snapshot.backends, {});
  });

  it('lastRequest is updated on each call', async () => {
    const { recordRequest, getSnapshot } = await import('../../src/stats/stats-store.js');
    recordRequest('claude');
    const first = getSnapshot().backends['claude']?.lastRequest;
    await new Promise((r) => setTimeout(r, 10));
    recordRequest('claude');
    const second = getSnapshot().backends['claude']?.lastRequest;
    assert.notStrictEqual(first, second);
  });
});

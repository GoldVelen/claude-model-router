import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('printStats', () => {
  beforeEach(async () => {
    const { resetStats } = await import('../../src/stats/stats-store.js');
    resetStats();
  });

  it('does not throw when called with empty stats', async () => {
    const { printStats } = await import('../../src/commands/stats.js');
    assert.doesNotThrow(() => printStats());
  });

  it('does not throw after recording requests', async () => {
    const { recordRequest } = await import('../../src/stats/stats-store.js');
    const { printStats } = await import('../../src/commands/stats.js');
    recordRequest('claude');
    recordRequest('deepseek');
    assert.doesNotThrow(() => printStats());
  });
});

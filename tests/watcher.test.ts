import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { startConfigWatcher } from '../src/watcher.js';

describe('startConfigWatcher', () => {
  const TEST_PATH = '/tmp/cmr-test-watcher.json';

  beforeEach(() => {
    writeFileSync(TEST_PATH, JSON.stringify({ port: 3000 }), 'utf-8');
  });

  afterEach(() => {
    try { unlinkSync(TEST_PATH); } catch { /* ignore */ }
  });

  it('returns a watcher instance', () => {
    const watcher = startConfigWatcher(TEST_PATH, () => {});
    assert.ok(watcher);
    assert.strictEqual(typeof watcher.close, 'function');
    watcher.close();
  });

  it('watcher is closeable', () => {
    const watcher = startConfigWatcher(TEST_PATH, () => {});
    watcher.close();
    assert.ok(true);
  });

  it('handles ENOENT via error handler without throwing', () => {
    try { unlinkSync(TEST_PATH); } catch { /* ignore */ }

    let threw = false;
    try {
      const watcher = startConfigWatcher(TEST_PATH, () => {});
      watcher.close();
    } catch {
      threw = true;
    }
    assert.strictEqual(threw, false);
  });
});

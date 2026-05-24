import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

const ORIG_ENV = { ...process.env };

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env['CMR_PORT'];
    delete process.env['CMR_DEEPSEEK_KEY'];
    delete process.env['CMR_CLAUDE_KEY'];
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
  });

  it('reads CMR_PORT from env', async () => {
    process.env['CMR_PORT'] = '9999';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.port, 9999);
  });

  it('reads CMR_DEEPSEEK_KEY from env', async () => {
    process.env['CMR_DEEPSEEK_KEY'] = 'ds-key-env';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.deepseek.apiKey, 'ds-key-env');
  });

  it('reads CMR_CLAUDE_KEY from env', async () => {
    process.env['CMR_CLAUDE_KEY'] = 'cl-key-env';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.claude.apiKey, 'cl-key-env');
  });

  it('has default aliases', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.aliases['dsp'], 'deepseek-v4-pro');
    assert.strictEqual(config.aliases['opus'], 'claude-opus-4-7');
    assert.strictEqual(config.aliases['dsf'], 'deepseek-v4-flash');
    assert.strictEqual(config.aliases['sonnet'], 'claude-sonnet-4-6');
    assert.strictEqual(config.aliases['haiku'], 'claude-haiku-4-5');
  });
});

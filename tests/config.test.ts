import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ORIG_ENV = { ...process.env };
const TEST_CONFIG_DIR = join(tmpdir(), `cmr-config-test-${process.pid}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json');

describe('loadConfig', () => {
  beforeEach(() => {
    delete process.env['CMR_PORT'];
    delete process.env['CMR_DEEPSEEK_KEY'];
    delete process.env['CMR_CLAUDE_KEY'];
    delete process.env['CMR_OLLAMA_KEY'];
    if (!existsSync(TEST_CONFIG_DIR)) mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    rmSync(TEST_CONFIG_PATH, { force: true });
    process.env['CMR_CONFIG_PATH'] = TEST_CONFIG_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    rmSync(TEST_CONFIG_PATH, { force: true });
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

  it('reads CMR_OLLAMA_KEY from env when a local backend is explicitly configured', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      port: 3457,
      logLevel: 'info',
      backends: {
        ollama: {
          url: 'http://127.0.0.1:11434',
          apiKey: 'ollama-config',
          path: '/v1/chat/completions',
          modelPattern: '^qwen3-coder:',
          protocol: 'openai-chat',
        },
      },
      aliases: {},
    }), 'utf-8');

    process.env['CMR_OLLAMA_KEY'] = 'ollama-env';
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.ollama.apiKey, 'ollama-env');
  });

  it('has default aliases', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.aliases['dsp'], 'deepseek-v4-pro');
    assert.strictEqual(config.aliases['opus'], 'claude-opus-4-7');
    assert.strictEqual(config.aliases['dsf'], 'deepseek-v4-flash');
    assert.strictEqual(config.aliases['sonnet'], 'claude-sonnet-4-6');
    assert.strictEqual(config.aliases['haiku'], 'claude-haiku-4-5');
    assert.strictEqual(config.aliases['local'], undefined);
    assert.strictEqual(config.aliases['qwen'], undefined);
  });

  it('has empty routingTags by default', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.deepStrictEqual(config.routingTags, {});
  });

  it('does not enable local backends by default', async () => {
    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.ollama, undefined);
    assert.strictEqual(config.backends.ollamaResponses, undefined);
  });

  it('merges new default backends and aliases into existing config', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      port: 3457,
      logLevel: 'info',
      backends: {
        deepseek: {
          url: 'https://api.deepseek.com',
          apiKey: 'test-ds-key',
        },
        claude: {
          url: 'https://api.anthropic.com',
          apiKey: 'test-cl-key',
        },
      },
      aliases: {
        dsp: 'deepseek-v4-pro',
      },
    }), 'utf-8');

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.ollama, undefined);
    assert.strictEqual(config.backends.ollamaResponses, undefined);
    assert.strictEqual(config.aliases['local'], undefined);
    assert.strictEqual(config.aliases['qwen'], undefined);
  });

  it('auto-applies the deepseek sanitizer to deepseek responses backends', async () => {
    writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
      port: 3457,
      logLevel: 'info',
      backends: {
        deepseekResponses: {
          url: 'https://api.deepseek.com',
          apiKey: 'test-ds-key',
          path: '/v1/chat/completions',
          modelPattern: '^deepseek-',
          protocol: 'openai-responses',
        },
      },
      aliases: {},
    }), 'utf-8');

    const { loadConfig } = await import('../src/config.js');
    const config = loadConfig();
    assert.strictEqual(config.backends.deepseekResponses?.sanitizer, 'deepseek');
  });
});

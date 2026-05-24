import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveModel, selectBackend, routeRequest } from '../src/router.js';
import { type Config, type BackendConfig } from '../src/types.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    port: 3457,
    logLevel: 'silent',
    backends: {
      deepseek: {
        url: 'https://api.deepseek.com',
        apiKey: 'ds-key',
        path: '/anthropic/v1/messages',
        modelPattern: '^deepseek-',
        sanitizer: 'deepseek' as const,
      },
      claude: {
        url: 'https://api.anthropic.com',
        apiKey: 'cl-key',
        path: '/v1/messages',
        modelPattern: '^claude-',
      },
    },
    aliases: {
      dsp: 'deepseek-v4-pro',
      opus: 'claude-opus-4-7',
    },
    ...overrides,
  };
}

describe('resolveModel', () => {
  it('resolves known alias', () => {
    const aliases = { dsp: 'deepseek-v4-pro' };
    assert.strictEqual(resolveModel('dsp', aliases), 'deepseek-v4-pro');
  });

  it('passes through unknown model', () => {
    assert.strictEqual(resolveModel('unknown-model', {}), 'unknown-model');
  });

  it('passes through if no alias matches', () => {
    const aliases = { dsp: 'deepseek-v4-pro' };
    assert.strictEqual(resolveModel('deepseek-v4-flash', aliases), 'deepseek-v4-flash');
  });
});

describe('selectBackend', () => {
  const backends: Record<string, BackendConfig> = {
    deepseek: {
      url: 'https://api.deepseek.com',
      apiKey: 'ds-key',
      modelPattern: '^deepseek-',
      sanitizer: 'deepseek',
    },
    claude: {
      url: 'https://api.anthropic.com',
      apiKey: 'cl-key',
      modelPattern: '^claude-',
    },
  };

  it('matches claude models', () => {
    const backend = selectBackend('claude-opus-4-7', backends);
    assert.ok(backend);
    assert.strictEqual(backend!.apiKey, 'cl-key');
  });

  it('matches deepseek models', () => {
    const backend = selectBackend('deepseek-v4-pro', backends);
    assert.ok(backend);
    assert.strictEqual(backend!.apiKey, 'ds-key');
  });

  it('falls back to first backend for unknown model', () => {
    const backend = selectBackend('unknown-model', backends);
    assert.ok(backend);
  });

  it('returns null for empty backends', () => {
    const backend = selectBackend('claude-opus', {});
    assert.strictEqual(backend, null);
  });

  it('skips backends without modelPattern', () => {
    const backendsNoPattern: Record<string, BackendConfig> = {
      default: { url: 'https://example.com', apiKey: 'key' },
      claude: { url: 'https://api.anthropic.com', apiKey: 'cl-key', modelPattern: '^claude-' },
    };
    const backend = selectBackend('claude-opus', backendsNoPattern);
    assert.ok(backend);
    assert.strictEqual(backend!.apiKey, 'cl-key');
  });
});

describe('routeRequest', () => {
  it('routes claude alias to claude backend', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'opus' }));
    assert.strictEqual(result.url, 'https://api.anthropic.com');
    assert.strictEqual(result.path, '/v1/messages');
    assert.strictEqual(result.apiKey, 'cl-key');
  });

  it('routes deepseek alias to deepseek backend', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'dsp' }));
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(result.path, '/anthropic/v1/messages');
    assert.strictEqual(result.apiKey, 'ds-key');
  });

  it('falls back for unknown model', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'gpt-4' }));
    assert.ok(result.url.length > 0);
  });

  it('replaces model name in body', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'opus' }));
    const parsed = JSON.parse(result.body);
    assert.strictEqual(parsed.model, 'claude-opus-4-7');
  });
});

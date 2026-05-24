import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateConfig } from '../src/validator.js';

describe('validateConfig', () => {
  it('returns no errors for valid config', () => {
    const errors = validateConfig({
      port: 3457,
      logLevel: 'info',
      backends: {
        claude: { url: 'https://api.anthropic.com', apiKey: 'sk-test' },
        deepseek: { url: 'https://api.deepseek.com', apiKey: 'sk-test' },
      },
      aliases: { opus: 'claude-opus-4-7' },
    });
    assert.strictEqual(errors.length, 0);
  });

  it('rejects invalid port', () => {
    const errors = validateConfig({
      port: 99999,
      backends: { claude: { url: 'https://api.anthropic.com', apiKey: 'k' } },
    });
    assert.ok(errors.some((e) => e.field === 'port'));
  });

  it('rejects missing backends', () => {
    const errors = validateConfig({ port: 3457 });
    assert.ok(errors.some((e) => e.field === 'backends'));
  });

  it('rejects empty backends', () => {
    const errors = validateConfig({
      port: 3457,
      backends: {},
    });
    assert.ok(errors.some((e) => e.field === 'backends' && e.message.includes('at least one')));
  });

  it('rejects missing backend url', () => {
    const errors = validateConfig({
      port: 3457,
      backends: { claude: { apiKey: 'k' } },
    });
    assert.ok(errors.some((e) => e.field === 'backends.claude.url'));
  });

  it('rejects invalid backend url', () => {
    const errors = validateConfig({
      port: 3457,
      backends: { claude: { url: 'not-a-url', apiKey: 'k' } },
    });
    assert.ok(errors.some((e) => e.field === 'backends.claude.url' && e.message.includes('valid URL')));
  });

  it('rejects missing apiKey', () => {
    const errors = validateConfig({
      port: 3457,
      backends: { claude: { url: 'https://api.anthropic.com' } },
    });
    assert.ok(errors.some((e) => e.field === 'backends.claude.apiKey'));
  });

  it('rejects null backend value', () => {
    const errors = validateConfig({
      port: 3457,
      backends: { broken: null as unknown as Record<string, unknown> },
    });
    assert.ok(errors.some((e) => e.field === 'backends.broken'));
  });

  it('rejects invalid aliases type', () => {
    const errors = validateConfig({
      port: 3457,
      backends: { claude: { url: 'https://api.anthropic.com', apiKey: 'k' } },
      aliases: 'not-an-object',
    });
    assert.ok(errors.some((e) => e.field === 'aliases'));
  });

  it('collects multiple errors', () => {
    const errors = validateConfig({
      port: -1,
      backends: {},
    });
    assert.ok(errors.length >= 2);
  });
});

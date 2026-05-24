import { describe, it } from 'node:test';
import assert from 'node:assert';
import { redactConfig } from '../../src/utils/redact.js';

describe('redactConfig', () => {
  it('replaces apiKey with *** in all backends', () => {
    const config = {
      port: 3457,
      backends: {
        a: { url: 'https://a.example.com', apiKey: 'sk-secret-a' },
        b: { url: 'https://b.example.com', apiKey: 'sk-secret-b' },
      },
    };
    const result = redactConfig(config);
    assert.strictEqual(result.backends['a']?.apiKey, '***');
    assert.strictEqual(result.backends['b']?.apiKey, '***');
  });

  it('does not mutate the original config', () => {
    const config = {
      backends: { x: { url: 'https://x.example.com', apiKey: 'sk-original' } },
    };
    const result = redactConfig(config);
    assert.strictEqual(config.backends['x']?.apiKey, 'sk-original');
    assert.strictEqual(result.backends['x']?.apiKey, '***');
    assert.notStrictEqual(result, config);
  });

  it('preserves non-apiKey fields', () => {
    const config = {
      port: 3457,
      logLevel: 'info',
      backends: { c: { url: 'https://c.example.com', apiKey: 'sk', modelPattern: '^test-' } },
    };
    const result = redactConfig(config);
    assert.strictEqual(result.port, 3457);
    assert.strictEqual(result.logLevel, 'info');
    assert.strictEqual(result.backends['c']?.url, 'https://c.example.com');
    assert.strictEqual(result.backends['c']?.modelPattern, '^test-');
    assert.strictEqual(result.backends['c']?.apiKey, '***');
  });

  it('handles empty backends', () => {
    const config = { port: 3457, backends: {} };
    const result = redactConfig(config);
    assert.deepStrictEqual(Object.keys(result.backends), []);
  });
});

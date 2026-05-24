import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sanitizeForDeepseek } from '../src/sanitize.js';

describe('sanitizeForDeepseek', () => {
  it('removes thinking field', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled', budget_tokens: 16000 },
      messages: [],
    });
    const result = JSON.parse(sanitizeForDeepseek(body));
    assert.strictEqual(result.thinking, undefined);
  });

  it('changes tool_choice any to auto', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-pro',
      tool_choice: { type: 'any' },
      messages: [],
    });
    const result = JSON.parse(sanitizeForDeepseek(body));
    assert.deepStrictEqual(result.tool_choice, { type: 'auto' });
  });

  it('leaves other tool_choice values intact', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-pro',
      tool_choice: { type: 'auto' },
      messages: [],
    });
    const result = JSON.parse(sanitizeForDeepseek(body));
    assert.deepStrictEqual(result.tool_choice, { type: 'auto' });
  });

  it('returns original body on invalid JSON', () => {
    const result = sanitizeForDeepseek('not-json');
    assert.strictEqual(result, 'not-json');
  });

  it('preserves other fields', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    });
    const result = JSON.parse(sanitizeForDeepseek(body));
    assert.strictEqual(result.model, 'deepseek-v4-pro');
    assert.strictEqual(result.max_tokens, 100);
  });
});

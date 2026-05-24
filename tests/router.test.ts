import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveModel, isClaude } from '../src/router.js';

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

describe('isClaude', () => {
  it('returns true for claude-* models', () => {
    assert.strictEqual(isClaude('claude-opus-4-7'), true);
    assert.strictEqual(isClaude('claude-sonnet-4-6'), true);
    assert.strictEqual(isClaude('claude-haiku-4-5'), true);
  });

  it('returns false for deepseek models', () => {
    assert.strictEqual(isClaude('deepseek-v4-pro'), false);
    assert.strictEqual(isClaude('deepseek-v4-flash'), false);
  });

  it('returns false for empty string', () => {
    assert.strictEqual(isClaude(''), false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatModelRouteLine } from '../src/startup-summary.js';
import { type Config } from '../src/types.js';

function makeConfig(): Config {
  return {
    port: 3457,
    logLevel: 'silent',
    backends: {
      deepseek: {
        url: 'https://api.deepseek.com',
        apiKey: 'ds-key',
        modelPattern: '^deepseek-',
        protocol: 'anthropic',
      },
      claude: {
        url: 'https://socheap.ai',
        apiKey: 'cl-key',
        modelPattern: '^claude-',
        protocol: 'anthropic',
      },
      ollamaResponses: {
        url: 'http://127.0.0.1:11434',
        apiKey: 'ollama',
        path: '/v1/chat/completions',
        modelPattern: '^qwen3-coder:',
        defaultModel: 'qwen3-coder:30b',
        protocol: 'openai-responses',
      },
    },
    aliases: {
      local: 'qwen3-coder:30b',
      dsp: 'deepseek-v4-pro',
    },
    routingTags: {
      qwen: 'qwen3-coder:30b',
    },
  };
}

describe('formatModelRouteLine', () => {
  it('shows local aliases as the ollama host instead of the deepseek fallback', () => {
    const line = formatModelRouteLine('local', 'qwen3-coder:30b', makeConfig(), 'openai-responses');
    assert.ok(line.includes('local'));
    assert.ok(line.includes('qwen3-coder:30b'));
    assert.ok(line.endsWith('127.0.0.1'));
  });

  it('shows remote aliases on their matching remote host', () => {
    const line = formatModelRouteLine('dsp', 'deepseek-v4-pro', makeConfig());
    assert.ok(line.endsWith('api.deepseek.com'));
  });

  it('marks unknown models as unmatched', () => {
    const line = formatModelRouteLine('x', 'unknown-model', makeConfig());
    assert.ok(line.endsWith('unmatched'));
  });
});

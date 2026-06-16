import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveModel, selectBackend, routeRequest, selectBackends } from '../src/router.js';
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
        protocol: 'anthropic' as const,
        sanitizer: 'deepseek' as const,
      },
      claude: {
        url: 'https://api.anthropic.com',
        apiKey: 'cl-key',
        path: '/v1/messages',
        modelPattern: '^claude-',
        protocol: 'anthropic' as const,
      },
      ollama: {
        url: 'http://127.0.0.1:11434',
        apiKey: 'ollama-key',
        path: '/v1/chat/completions',
        modelPattern: '^qwen3-coder:',
        protocol: 'openai-chat' as const,
      },
    },
    aliases: {
      dsp: 'deepseek-v4-pro',
      opus: 'claude-opus-4-7',
      gpt55: 'gpt-5.5',
      local: 'qwen3-coder:30b',
      qwen: 'qwen3-coder:30b',
      'opus4.8': 'claude-opus-4-8',
    },
    routingTags: {},
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
      protocol: 'anthropic',
      sanitizer: 'deepseek',
    },
    claude: {
      url: 'https://api.anthropic.com',
      apiKey: 'cl-key',
      modelPattern: '^claude-',
      protocol: 'anthropic',
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
    const result = routeRequest(config, JSON.stringify({ model: 'opus' }), 'anthropic');
    assert.strictEqual(result.url, 'https://api.anthropic.com');
    assert.strictEqual(result.path, '/v1/messages');
    assert.strictEqual(result.apiKey, 'cl-key');
  });

  it('routes deepseek alias to deepseek backend', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'dsp' }), 'anthropic');
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(result.path, '/anthropic/v1/messages');
    assert.strictEqual(result.apiKey, 'ds-key');
  });

  it('falls back for unknown model', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'gpt-4' }), 'anthropic');
    assert.ok(result.url.length > 0);
  });

  it('replaces model name in body', () => {
    const config = makeConfig();
    const result = routeRequest(config, JSON.stringify({ model: 'opus' }), 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(parsed.model, 'claude-opus-4-7');
  });

  it('routes openai-chat models to openai backend', () => {
    const config = makeConfig({
      backends: {
        openai: {
          url: 'https://api.openai.com',
          apiKey: 'oa-key',
          path: '/v1/chat/completions',
          modelPattern: '^gpt-|^o[134]($|-)',
          protocol: 'openai-chat',
        },
        deepseek: {
          url: 'https://api.deepseek.com',
          apiKey: 'ds-key',
          path: '/v1/chat/completions',
          modelPattern: '^deepseek-',
          protocol: 'openai-chat',
        },
      },
      aliases: {
        g55: 'gpt-5.5',
      },
    });
    const result = routeRequest(config, JSON.stringify({ model: 'g55' }), 'openai-chat');
    assert.strictEqual(result.url, 'https://api.openai.com');
    assert.strictEqual(result.path, '/v1/chat/completions');
    assert.strictEqual(result.apiKey, 'oa-key');
    assert.strictEqual(JSON.parse(result.body).model, 'gpt-5.5');
  });

  it('routes cmr local tag to ollama backend', () => {
    const config = makeConfig({
      routingTags: {
        local: 'qwen3-coder:30b',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [{ role: 'user', content: 'cmr:local\n帮我写一个测试' }],
    });
    const result = routeRequest(config, body, 'openai-chat');
    assert.strictEqual(result.url, 'http://127.0.0.1:11434');
    assert.strictEqual(result.path, '/v1/chat/completions');
    assert.strictEqual(result.apiKey, 'ollama-key');
    assert.strictEqual(JSON.parse(result.body).model, 'qwen3-coder:30b');
  });

  it('uses default path for openai-chat backends when omitted', () => {
    const config = makeConfig({
      backends: {
        openai: {
          url: 'https://api.openai.com',
          apiKey: 'oa-key',
          modelPattern: '^gpt-',
          protocol: 'openai-chat',
        },
      },
      aliases: {},
    });
    const result = routeRequest(config, JSON.stringify({ model: 'gpt-5.5' }), 'openai-chat');
    assert.strictEqual(result.path, '/v1/chat/completions');
  });

  it('overrides anthropic model from a cmr tag in the latest user message', () => {
    const config = makeConfig({
      aliases: {
        dsp: 'deepseek-v4-pro',
        gpt55: 'gpt-5.5',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [
        { role: 'user', content: 'cmr:dsp\n请分析这个报错' },
      ],
    });
    const result = routeRequest(config, body, 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.messages[0]?.content, '请分析这个报错');
  });

  it('prefers routingTags over aliases for cmr tag resolution', () => {
    const config = makeConfig({
      aliases: {
        dsp: 'deepseek-v4-flash',
        gpt55: 'gpt-5.5',
      },
      routingTags: {
        dsp: 'deepseek-v4-pro',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [
        { role: 'user', content: 'cmr:dsp\n请分析这个报错' },
      ],
    });
    const result = routeRequest(config, body, 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.messages[0]?.content, '请分析这个报错');
  });

  it('supports cmr tags inside openai chat messages and strips the control token', () => {
    const config = makeConfig({
      backends: {
        openai: {
          url: 'https://api.openai.com',
          apiKey: 'oa-key',
          path: '/v1/chat/completions',
          modelPattern: '^gpt-',
          protocol: 'openai-chat',
        },
        claude: {
          url: 'https://api.anthropic.com',
          apiKey: 'cl-key',
          path: '/v1/chat/completions',
          modelPattern: '^claude-',
          protocol: 'openai-chat',
        },
      },
      aliases: {
        gpt55: 'gpt-5.5',
        'opus4.8': 'claude-opus-4-8',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [
        { role: 'system', content: 'follow repo rules' },
        { role: 'user', content: 'cmr:opus4.8 修这个 bug' },
      ],
    });
    const result = routeRequest(config, body, 'openai-chat');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.anthropic.com');
    assert.strictEqual(parsed.model, 'claude-opus-4-8');
    assert.strictEqual(parsed.messages[1]?.content, '修这个 bug');
  });

  it('supports cmr tags inside responses input strings', () => {
    const config = makeConfig({
      backends: {
        openai: {
          url: 'https://api.openai.com',
          apiKey: 'oa-key',
          path: '/v1/responses',
          modelPattern: '^gpt-',
          protocol: 'openai-responses',
        },
        deepseek: {
          url: 'https://api.deepseek.com',
          apiKey: 'ds-key',
          path: '/v1/responses',
          modelPattern: '^deepseek-',
          protocol: 'openai-responses',
        },
      },
      aliases: {
        dsp: 'deepseek-v4-pro',
        gpt55: 'gpt-5.5',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      input: 'cmr:dsp 请输出修复方案',
    });
    const result = routeRequest(config, body, 'openai-responses');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.input, '请输出修复方案');
  });

  it('falls back to aliases when routingTags does not define the cmr tag', () => {
    const config = makeConfig({
      backends: {
        openai: {
          url: 'https://api.openai.com',
          apiKey: 'oa-key',
          path: '/v1/responses',
          modelPattern: '^gpt-',
          protocol: 'openai-responses',
        },
        deepseek: {
          url: 'https://api.deepseek.com',
          apiKey: 'ds-key',
          path: '/v1/responses',
          modelPattern: '^deepseek-',
          protocol: 'openai-responses',
        },
      },
      aliases: {
        dsp: 'deepseek-v4-pro',
        gpt55: 'gpt-5.5',
      },
      routingTags: {
        dsf: 'deepseek-v4-flash',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      input: 'cmr:dsp 请输出修复方案',
    });
    const result = routeRequest(config, body, 'openai-responses');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.input, '请输出修复方案');
  });

  it('strips unknown cmr tags while leaving model fallback behavior intact', () => {
    const config = makeConfig({
      aliases: {
        gpt55: 'gpt-5.5',
      },
      routingTags: {},
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [
        { role: 'user', content: 'cmr:unknown\n继续这个任务' },
      ],
    });
    const result = routeRequest(config, body, 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'unknown');
    assert.strictEqual(parsed.messages[0]?.content, '继续这个任务');
  });

  it('ignores cmr tags from older user messages when the latest user turn has none', () => {
    const config = makeConfig({
      aliases: {
        dsp: 'deepseek-v4-pro',
        opus: 'claude-opus-4-7',
      },
    });
    const body = JSON.stringify({
      model: 'opus',
      messages: [
        { role: 'user', content: 'cmr:dsp 先看这个问题' },
        { role: 'assistant', content: '好的' },
        { role: 'user', content: '现在继续，不指定模型' },
      ],
    });
    const result = routeRequest(config, body, 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.anthropic.com');
    assert.strictEqual(parsed.model, 'claude-opus-4-7');
    assert.strictEqual(parsed.messages[0]?.content, 'cmr:dsp 先看这个问题');
    assert.strictEqual(parsed.messages[2]?.content, '现在继续，不指定模型');
  });

  it('supports cmr tags inside anthropic content blocks', () => {
    const config = makeConfig({
      aliases: {
        dsp: 'deepseek-v4-pro',
        gpt55: 'gpt-5.5',
      },
    });
    const body = JSON.stringify({
      model: 'gpt55',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'cmr:dsp\n请处理这个任务' },
          ],
        },
      ],
    });
    const result = routeRequest(config, body, 'anthropic');
    const parsed = JSON.parse(result.body);
    assert.strictEqual(result.url, 'https://api.deepseek.com');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.messages[0]?.content[0]?.text, '请处理这个任务');
  });
});

describe('selectBackends', () => {
  it('filters by protocol before applying model routing', () => {
    const backends: Record<string, BackendConfig> = {
      anthropic: {
        url: 'https://api.anthropic.com',
        apiKey: 'cl-key',
        modelPattern: '^claude-',
        protocol: 'anthropic',
      },
      openai: {
        url: 'https://api.openai.com',
        apiKey: 'oa-key',
        modelPattern: '^gpt-',
        protocol: 'openai-chat',
      },
    };
    const result = selectBackends('gpt-5.5', backends, 'openai-chat');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]?.apiKey, 'oa-key');
  });

  it('returns no backends when protocols do not match request family', () => {
    const backends: Record<string, BackendConfig> = {
      anthropic: {
        url: 'https://api.anthropic.com',
        apiKey: 'cl-key',
        modelPattern: '^claude-',
        protocol: 'anthropic',
      },
    };
    const result = selectBackends('gpt-5.5', backends, 'openai-chat');
    assert.strictEqual(result.length, 0);
  });
});

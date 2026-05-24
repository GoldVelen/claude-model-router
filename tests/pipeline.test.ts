import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getPipelineStages,
  resolveStageModel,
  interpolatePrompt,
} from '../src/pipeline.js';
import { type Config } from '../src/types.js';

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    port: 3457,
    logLevel: 'silent',
    backends: {
      claude: {
        url: 'https://api.anthropic.com',
        apiKey: 'key',
        modelPattern: '^claude-',
      },
      deepseek: {
        url: 'https://api.deepseek.com',
        apiKey: 'key',
        modelPattern: '^deepseek-',
      },
    },
    aliases: {
      opus: 'claude-opus-4-7',
      dsp: 'deepseek-v4-pro',
      sonnet: 'claude-sonnet-4-6',
      dsf: 'deepseek-v4-flash',
    },
    ...overrides,
  };
}

describe('getPipelineStages', () => {
  it('returns default stages when no pipeline config', () => {
    const config = makeConfig();
    const stages = getPipelineStages(config);
    assert.ok(stages['plan']);
    assert.ok(stages['implement']);
    assert.ok(stages['test']);
    assert.ok(stages['report']);
    assert.strictEqual(stages['plan']!.model, 'opus');
    assert.strictEqual(stages['implement']!.model, 'dsp');
    assert.strictEqual(stages['test']!.model, 'sonnet');
    assert.strictEqual(stages['report']!.model, 'dsf');
  });

  it('merges custom pipeline with defaults', () => {
    const config = makeConfig({
      pipeline: {
        plan: { model: 'sonnet', prompt: 'Custom plan prompt for {task}' },
      },
    });
    const stages = getPipelineStages(config);
    assert.strictEqual(stages['plan']!.model, 'sonnet');
    assert.strictEqual(stages['plan']!.prompt, 'Custom plan prompt for {task}');
    assert.strictEqual(stages['implement']!.model, 'dsp');
  });

  it('allows adding new stages', () => {
    const config = makeConfig({
      pipeline: {
        review: { model: 'opus', prompt: 'Review: {task}' },
      },
    });
    const stages = getPipelineStages(config);
    assert.ok(stages['review']);
    assert.strictEqual(stages['review']!.model, 'opus');
    assert.ok(stages['plan']);
  });
});

describe('resolveStageModel', () => {
  it('resolves alias to full model name', () => {
    const config = makeConfig();
    assert.strictEqual(resolveStageModel('opus', config), 'claude-opus-4-7');
  });

  it('passes through unknown models', () => {
    const config = makeConfig();
    assert.strictEqual(resolveStageModel('gpt-4', config), 'gpt-4');
  });
});

describe('interpolatePrompt', () => {
  it('replaces context variables', () => {
    const result = interpolatePrompt('Plan: {plan}\nTask: {task}', {
      task: 'build app',
      plan: 'use React',
    });
    assert.strictEqual(result, 'Plan: use React\nTask: build app');
  });

  it('leaves unknown variables as-is', () => {
    const result = interpolatePrompt('Value: {missing}', { task: 'test' });
    assert.strictEqual(result, 'Value: {missing}');
  });

  it('handles empty context', () => {
    const result = interpolatePrompt('Hello', { task: 'x' });
    assert.strictEqual(result, 'Hello');
  });
});

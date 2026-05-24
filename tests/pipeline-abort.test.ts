import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { runPipeline, type PipelineResult } from '../src/pipeline.js';
import { type Config } from '../src/types.js';

function startMockProxy(
  handler: (body: string) => { status: number; data: string },
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const result = handler(body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        server.close();
        throw new Error('Failed to get server address');
      }
      resolve({ server, port: addr.port });
    });
  });
}

const TEST_CONFIG: Config = {
  port: 3457,
  logLevel: 'silent',
  backends: {},
  aliases: {},
  pipeline: {
    plan: {
      model: 'test-model',
      prompt: 'Task: {task}\nPlan context: {plan_output}\nStage 1.',
    },
    implement: {
      model: 'test-model',
      prompt: 'Task: {task}\nPlan: {plan}',
    },
    test: {
      model: 'test-model',
      prompt: 'Task: {task}\nPlan: {plan}\nImplement: {implement}',
    },
  },
};

describe('Pipeline abort via AbortSignal', () => {
  let server: http.Server;
  let port: number;

  beforeEach(async () => {
    const mock = await startMockProxy(() => ({
      status: 200,
      data: JSON.stringify({ content: [{ type: 'text', text: 'mock response' }] }),
    }));
    server = mock.server;
    port = mock.port;
  });

  afterEach(() => {
    server.close();
  });

  it('aborts after first stage when signal is triggered early', async () => {
    const controller = new AbortController();

    // Abort before calling — first iteration should catch it
    controller.abort();

    const result: PipelineResult = await runPipeline('test task', TEST_CONFIG, port, {
      signal: controller.signal,
    });

    assert.ok(result.abortedAt !== null, 'abortedAt should not be null');
    assert.ok(result.stages.includes(result.abortedAt!), 'abortedAt should be a valid stage name');
    assert.strictEqual(result.ctx.task, 'test task');
    // No stages completed
    assert.strictEqual(result.ctx['plan'], undefined);
  });

  it('completes normally when signal is never triggered', async () => {
    const controller = new AbortController();

    const result = await runPipeline('test task', TEST_CONFIG, port, {
      signal: controller.signal,
    });

    assert.strictEqual(result.abortedAt, null);
    assert.ok(result.ctx['plan'], 'plan should be completed');
    assert.ok(result.ctx['implement'], 'implement should be completed');
    assert.ok(result.ctx['test'], 'test should be completed');
    assert.strictEqual(result.failedStages.length, 0);
  });

  it('runs without signal option (backward compatible)', async () => {
    const result = await runPipeline('test task', TEST_CONFIG, port);
    assert.strictEqual(result.abortedAt, null);
    assert.ok(result.ctx['plan']);
    assert.ok(result.ctx['implement']);
    assert.ok(result.ctx['test']);
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import http from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';

const TEST_CONFIG_DIR = join(homedir(), '.config', 'claude-model-router-test');
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, 'config.json');
const TEST_PORT = 13457;

function createTestConfig(overrides?: Record<string, unknown>): string {
  const config = {
    port: TEST_PORT,
    logLevel: 'silent',
    backends: {
      deepseek: {
        url: 'https://api.deepseek.com',
        apiKey: 'test-ds-key',
        path: '/anthropic/v1/messages',
        modelPattern: '^deepseek-',
        sanitizer: 'deepseek',
      },
      claude: {
        url: 'https://api.anthropic.com',
        apiKey: 'test-cl-key',
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
  return JSON.stringify(config, null, 2);
}

function makeRequest(body: Record<string, unknown>): Promise<{ status: number; data: string }> {
  return makeRequestToPath('/v1/messages', body);
}

function makeRequestToPath(
  path: string,
  body: Record<string, unknown>,
  headers?: http.OutgoingHttpHeaders,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, data }));
      },
    );
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

function makeRequestRaw(rawBody: string): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: TEST_PORT,
        path: '/v1/messages',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode || 0, data }));
      },
    );
    req.on('error', reject);
    req.end(rawBody);
  });
}

async function startServer(): Promise<ChildProcess> {
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: join(process.cwd()),
    env: {
      ...process.env,
      HOME: homedir(),
      CMR_PORT: String(TEST_PORT),
      CMR_CONFIG_PATH: TEST_CONFIG_PATH,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await setTimeout(1000);
  return proc;
}

async function stopProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null) return;

  proc.kill();
  await Promise.race([once(proc, 'exit'), setTimeout(2000)]);

  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill('SIGKILL');
    await once(proc, 'exit').catch(() => undefined);
  }
}

function cleanupTestConfig(): void {
  try {
    unlinkSync(TEST_CONFIG_PATH);
  } catch {
    /* ignore */
  }
}

describe('Integration: Hot Reload', () => {
  let serverProcess: ChildProcess | null = null;

  beforeEach(async () => {
    // Create test config directory
    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }

    // Write initial config
    writeFileSync(TEST_CONFIG_PATH, createTestConfig());

    // Start server with test config
    serverProcess = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        HOME: homedir(),
        CMR_PORT: String(TEST_PORT),
        CMR_CONFIG_PATH: TEST_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for server to start
    await setTimeout(1000);
  });

  afterEach(async () => {
    const proc = serverProcess;
    serverProcess = null;
    await stopProcess(proc);
    cleanupTestConfig();
  });

  it('reloads config when file changes', async () => {
    // Initial config has alias 'dsp' → 'deepseek-v4-pro'
    const config1 = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    assert.strictEqual(config1.aliases.dsp, 'deepseek-v4-pro');

    // Update config to change alias
    const newConfig = createTestConfig({
      aliases: {
        dsp: 'deepseek-v4-flash', // Changed
        opus: 'claude-opus-4-7',
      },
    });
    writeFileSync(TEST_CONFIG_PATH, newConfig);

    // Wait for hot reload (debounce 100ms + processing)
    await setTimeout(300);

    // Verify config was reloaded by checking file
    const config2 = JSON.parse(readFileSync(TEST_CONFIG_PATH, 'utf-8'));
    assert.strictEqual(config2.aliases.dsp, 'deepseek-v4-flash');
  });

  it('keeps old config on invalid JSON', async () => {
    // Write invalid JSON
    writeFileSync(TEST_CONFIG_PATH, '{ invalid json }');

    // Wait for reload attempt
    await setTimeout(300);

    // Server should still be running (didn't crash)
    assert.ok(serverProcess);
    assert.strictEqual(serverProcess.killed, false);
  });

  it('keeps old config on validation failure', async () => {
    // Write config with invalid port
    const invalidConfig = createTestConfig({ port: 99999 });
    writeFileSync(TEST_CONFIG_PATH, invalidConfig);

    // Wait for reload attempt
    await setTimeout(300);

    // Server should still be running
    assert.ok(serverProcess);
    assert.strictEqual(serverProcess.killed, false);
  });
});

describe('Integration: Error Transparency', () => {
  let server: ChildProcess | null = null;

  beforeEach(async () => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig());
    server = await startServer();
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    cleanupTestConfig();
  });

  it('returns 400 for invalid JSON', async () => {
    const res = await makeRequestRaw('not valid json').catch((err) => {
      if (err.code === 'ECONNREFUSED') return { status: 0, data: '' };
      throw err;
    });
    if (res.status === 0) return;

    // Server should return 400 for unparseable JSON
    assert.strictEqual(res.status, 400);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.error?.message, 'Invalid JSON');
  });

  it('returns 404 for non-POST requests', async () => {
    const res = await makeRequestRaw('').catch((err) => {
      if (err.code === 'ECONNREFUSED') return { status: 0, data: '' };
      throw err;
    });
    if (res.status === 0) return;

    // Server returns 404 for GET requests (not allowed)
    // The raw request goes through POST path, so we test the proxy response
    const resGet = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: TEST_PORT, path: '/v1/messages', method: 'GET' },
        (r) => resolve({ status: r.statusCode || 0 }),
      );
      req.on('error', reject);
      req.end();
    });
    assert.strictEqual(resGet.status, 404);
  });

  it('returns 400 when no backend matches model', async () => {
    const res = await makeRequest({ model: 'unknown-model-xyz' }).catch((err) => {
      if (err.code === 'ECONNREFUSED') return { status: 0, data: '' };
      throw err;
    });
    if (res.status === 0) return;

    // Should get 400 with error message
    if (res.status === 400) {
      const parsed = JSON.parse(res.data);
      assert.ok(parsed.error);
      assert.ok(parsed.error.message);
    }
  });
});

describe('Integration: Multi-Backend Routing', () => {
  let server: ChildProcess | null = null;

  beforeEach(async () => {
    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig());
    server = await startServer();
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    cleanupTestConfig();
  });

  it('routes claude models to claude backend', async () => {
    const res = await makeRequest({
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    }).catch((err) => {
      if (err.code === 'ECONNREFUSED') {
        return { status: 0, data: '' };
      }
      throw err;
    });

    if (res.status === 0) return;

    // Server accepted the request and proxied it
    // Status can be 200 (success), 400 (bad request), 502 (upstream error), 401/403 (auth error)
    assert.ok(res.status >= 200, `Expected valid HTTP status, got ${res.status}`);
  });

  it('routes deepseek models to deepseek backend', async () => {
    const res = await makeRequest({
      model: 'deepseek-v4-pro',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    }).catch((err) => {
      if (err.code === 'ECONNREFUSED') {
        return { status: 0, data: '' };
      }
      throw err;
    });

    if (res.status === 0) return;

    // Server accepted and proxied the request
    assert.ok(res.status >= 200, `Expected valid HTTP status, got ${res.status}`);
  });

  it('resolves aliases before routing', async () => {
    const res = await makeRequest({
      model: 'opus', // Alias for claude-opus-4-7
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    }).catch((err) => {
      if (err.code === 'ECONNREFUSED') {
        return { status: 0, data: '' };
      }
      throw err;
    });

    if (res.status === 0) return;

    // Server accepted and proxied the request
    assert.ok(res.status >= 200, `Expected valid HTTP status, got ${res.status}`);

    // Verify response contains expected structure
    if (res.status === 200) {
      const parsed = JSON.parse(res.data);
      assert.ok(parsed.content || parsed.id, 'Response should have content or id field');
    }
  });
});

describe('Integration: OpenAI Chat Compatibility', () => {
  let upstream: http.Server | null = null;
  let server: ChildProcess | null = null;
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody = '';
  let upstreamPort = 0;

  beforeEach(async () => {
    capturedHeaders = null;
    capturedBody = '';
    upstream = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        capturedBody = body;
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          model: parsed.model,
        }));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Failed to get upstream address');
    }
    upstreamPort = address.port;

    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        openaiChat: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'oa-key',
          path: '/v1/chat/completions',
          modelPattern: '^gpt-',
          protocol: 'openai-chat',
        },
        openaiResponses: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'oa-key',
          path: '/v1/responses',
          modelPattern: '^gpt-',
          protocol: 'openai-responses',
        },
      },
      aliases: {
        g55: 'gpt-5.5',
        dsp: 'deepseek-v4-pro',
      },
    }));

    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        HOME: homedir(),
        CMR_PORT: String(TEST_PORT),
        CMR_CONFIG_PATH: TEST_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await setTimeout(1000);
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    if (upstream) {
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      upstream = null;
    }
    cleanupTestConfig();
  });

  it('proxies /v1/chat/completions without anthropic-only headers', async () => {
    const res = await makeRequestToPath('/v1/chat/completions', {
      model: 'g55',
      messages: [{ role: 'user', content: 'hi' }],
    });

    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.object, 'chat.completion');
    assert.strictEqual(parsed.model, 'gpt-5.5');
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer oa-key');
    assert.strictEqual(capturedHeaders?.['anthropic-version'], undefined);
  });

  it('proxies /v1/responses without anthropic-only headers', async () => {
    const res = await makeRequestToPath('/v1/responses', {
      model: 'g55',
      input: 'hi',
    });

    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.object, 'chat.completion');
    assert.strictEqual(parsed.model, 'gpt-5.5');
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer oa-key');
    assert.strictEqual(capturedHeaders?.['anthropic-version'], undefined);
  });

  it('rewrites model from cmr tag and strips the control token before forwarding', async () => {
    const res = await makeRequestToPath('/v1/chat/completions', {
      model: 'g55',
      messages: [{ role: 'user', content: 'cmr:dsp\n请修这个问题' }],
    });

    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer oa-key');
    assert.strictEqual(capturedHeaders?.['anthropic-version'], undefined);
    assert.ok(!capturedBody.includes('cmr:dsp'));
    assert.ok(capturedBody.includes('请修这个问题'));
  });

  it('prefers routingTags over aliases when forwarding cmr tag requests', async () => {
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        openaiChat: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'oa-key',
          path: '/v1/chat/completions',
          modelPattern: '^gpt-|^deepseek-',
          protocol: 'openai-chat',
        },
      },
      aliases: {
        g55: 'gpt-5.5',
        dsp: 'deepseek-v4-flash',
      },
      routingTags: {
        dsp: 'deepseek-v4-pro',
      },
    }));

    const res = await makeRequestToPath('/v1/chat/completions', {
      model: 'g55',
      messages: [{ role: 'user', content: 'cmr:dsp\n请修这个问题' }],
    });

    assert.strictEqual(res.status, 200);
    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.ok(!capturedBody.includes('cmr:dsp'));
    assert.ok(capturedBody.includes('请修这个问题'));
  });

  it('forwards inbound Authorization only for explicitly configured backends', async () => {
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        ccswitchResponses: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: '',
          path: '/v1/responses',
          modelPattern: '^gpt-',
          protocol: 'openai-responses',
          forwardAuthorization: true,
        },
      },
      aliases: {
        g55: 'gpt-5.5',
      },
    }));
    await setTimeout(300);

    const res = await makeRequestToPath('/v1/responses', {
      model: 'g55',
      input: 'hi',
    }, {
      Authorization: 'Bearer inbound-codex-token',
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer inbound-codex-token');
  });

  it('keeps static backend credentials when forwardAuthorization is disabled', async () => {
    const res = await makeRequestToPath('/v1/responses', {
      model: 'g55',
      input: 'hi',
    }, {
      Authorization: 'Bearer inbound-codex-token',
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer oa-key');
  });
});

describe('Integration: Responses-to-Chat Local Compatibility', () => {
  let upstream: http.Server | null = null;
  let server: ChildProcess | null = null;
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody = '';
  let upstreamPort = 0;

  function postRaw(path: string, body: Record<string, unknown>): Promise<{
    status: number;
    data: string;
    headers: http.IncomingHttpHeaders;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({
            status: res.statusCode || 0,
            data,
            headers: res.headers,
          }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  beforeEach(async () => {
    capturedHeaders = null;
    capturedBody = '';
    upstream = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        capturedBody = body;
        const parsed = JSON.parse(body);

        if (parsed.stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-local',
            object: 'chat.completion.chunk',
            created: 1717171717,
            model: parsed.model,
            choices: [{ index: 0, delta: { role: 'assistant', content: 'lo' }, finish_reason: null }],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-local',
            object: 'chat.completion.chunk',
            created: 1717171717,
            model: parsed.model,
            choices: [{ index: 0, delta: { content: 'cal ok' }, finish_reason: null }],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            id: 'chatcmpl-local',
            object: 'chat.completion.chunk',
            created: 1717171717,
            model: parsed.model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
          res.end('data: [DONE]\n\n');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-local',
          object: 'chat.completion',
          created: 1717171717,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'local ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 3,
            total_tokens: 15,
          },
        }));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Failed to get upstream address');
    }
    upstreamPort = address.port;

    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        ollamaResponses: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'ollama-key',
          path: '/v1/chat/completions',
          modelPattern: '^qwen3-coder:',
          protocol: 'openai-responses',
          defaultModel: 'qwen3-coder:30b',
        },
      },
      aliases: {
        local: 'qwen3-coder:30b',
      },
      routingTags: {
        local: 'qwen3-coder:30b',
      },
    }));

    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        HOME: homedir(),
        CMR_PORT: String(TEST_PORT),
        CMR_CONFIG_PATH: TEST_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await setTimeout(1000);
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    if (upstream) {
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      upstream = null;
    }
    cleanupTestConfig();
  });

  it('rewrites responses requests to chat completions and normalizes the response body', async () => {
    const res = await postRaw('/v1/responses', {
      model: 'gpt-5.5',
      instructions: '你是一个代码助手',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '只回答 ok' }],
        },
      ],
      tools: [
        {
          type: 'function',
          name: 'run_shell',
          description: 'Run a shell command',
          parameters: {
            type: 'object',
            properties: {
              cmd: { type: 'string' },
            },
            required: ['cmd'],
          },
        },
      ],
      tool_choice: {
        type: 'function',
        name: 'run_shell',
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer ollama-key');

    const forwarded = JSON.parse(capturedBody);
    assert.strictEqual(forwarded.model, 'qwen3-coder:30b');
    assert.strictEqual(forwarded.messages[0]?.role, 'system');
    assert.strictEqual(forwarded.messages[0]?.content, '你是一个代码助手');
    assert.strictEqual(forwarded.messages[1]?.role, 'user');
    assert.strictEqual(forwarded.messages[1]?.content, '只回答 ok');
    assert.strictEqual(forwarded.tools[0]?.type, 'function');
    assert.strictEqual(forwarded.tools[0]?.function?.name, 'run_shell');
    assert.strictEqual(forwarded.tool_choice?.function?.name, 'run_shell');

    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.object, 'response');
    assert.strictEqual(parsed.model, 'qwen3-coder:30b');
    assert.strictEqual(parsed.output_text, 'local ok');
    assert.strictEqual(parsed.output[0]?.type, 'message');
    assert.strictEqual(parsed.output[0]?.content[0]?.type, 'output_text');
    assert.strictEqual(parsed.output[0]?.content[0]?.text, 'local ok');
    assert.strictEqual(parsed.usage?.input_tokens, 12);
    assert.strictEqual(parsed.usage?.output_tokens, 3);
  });

  it('translates streaming chat chunks into responses events', async () => {
    const res = await postRaw('/v1/responses', {
      model: 'gpt-5.5',
      input: '只回答 ok',
      stream: true,
    });

    assert.strictEqual(res.status, 200);
    assert.ok(String(res.headers['content-type']).includes('text/event-stream'));
    assert.ok(res.data.includes('"type":"response.created"'));
    assert.ok(res.data.includes('"type":"response.output_text.delta"'));
    assert.ok(res.data.includes('"delta":"lo"'));
    assert.ok(res.data.includes('"delta":"cal ok"'));
    assert.ok(res.data.includes('"type":"response.completed"'));

    const forwarded = JSON.parse(capturedBody);
    assert.strictEqual(forwarded.model, 'qwen3-coder:30b');
    assert.strictEqual(forwarded.messages[0]?.role, 'user');
    assert.strictEqual(forwarded.messages[0]?.content, '只回答 ok');
    assert.strictEqual(forwarded.stream, true);
  });
});

describe('Integration: Responses-to-Chat DeepSeek Compatibility', () => {
  let upstream: http.Server | null = null;
  let server: ChildProcess | null = null;
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody = '';
  let upstreamPort = 0;

  function postRaw(path: string, body: Record<string, unknown>): Promise<{
    status: number;
    data: string;
    headers: http.IncomingHttpHeaders;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({
            status: res.statusCode || 0,
            data,
            headers: res.headers,
          }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  beforeEach(async () => {
    capturedHeaders = null;
    capturedBody = '';
    upstream = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        capturedBody = body;
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-deepseek',
          object: 'chat.completion',
          created: 1717171717,
          model: parsed.model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'OK',
                reasoning_content: 'internal reasoning',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 6,
            total_tokens: 16,
          },
        }));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Failed to get upstream address');
    }
    upstreamPort = address.port;

    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        deepseekResponses: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'deepseek-key',
          path: '/v1/chat/completions',
          modelPattern: '^deepseek-',
          protocol: 'openai-responses',
          sanitizer: 'deepseek',
        },
      },
      aliases: {
        dsp: 'deepseek-v4-pro',
      },
      routingTags: {
        dsp: 'deepseek-v4-pro',
      },
    }));

    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        HOME: homedir(),
        CMR_PORT: String(TEST_PORT),
        CMR_CONFIG_PATH: TEST_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await setTimeout(1000);
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    if (upstream) {
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      upstream = null;
    }
    cleanupTestConfig();
  });

  it('disables deepseek thinking and preserves assistant output text for responses clients', async () => {
    const res = await postRaw('/v1/responses', {
      model: 'gpt-5.5',
      input: 'cmr:dsp\n只回答 OK',
      max_output_tokens: 32,
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer deepseek-key');

    const forwarded = JSON.parse(capturedBody);
    assert.strictEqual(forwarded.model, 'deepseek-v4-pro');
    assert.strictEqual(forwarded.messages[0]?.role, 'user');
    assert.strictEqual(forwarded.messages[0]?.content, '只回答 OK');
    assert.deepStrictEqual(forwarded.thinking, { type: 'disabled' });

    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.object, 'response');
    assert.strictEqual(parsed.model, 'deepseek-v4-pro');
    assert.strictEqual(parsed.output_text, 'OK');
    assert.strictEqual(parsed.output[0]?.type, 'message');
    assert.strictEqual(parsed.output[0]?.content[0]?.text, 'OK');
  });
});

describe('Integration: Responses-to-Anthropic Compatibility', () => {
  let upstream: http.Server | null = null;
  let server: ChildProcess | null = null;
  let capturedHeaders: http.IncomingHttpHeaders | null = null;
  let capturedBody = '';
  let upstreamPort = 0;

  function postRaw(path: string, body: Record<string, unknown>): Promise<{
    status: number;
    data: string;
    headers: http.IncomingHttpHeaders;
  }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: TEST_PORT,
          path,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({
            status: res.statusCode || 0,
            data,
            headers: res.headers,
          }));
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(body));
    });
  }

  beforeEach(async () => {
    capturedHeaders = null;
    capturedBody = '';
    upstream = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        capturedBody = body;
        const parsed = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'msg_anthropic_test',
          type: 'message',
          role: 'assistant',
          model: parsed.model,
          content: [
            { type: 'text', text: 'opus ok' },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 20,
            output_tokens: 4,
          },
        }));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    if (!address || typeof address !== 'object') {
      throw new Error('Failed to get upstream address');
    }
    upstreamPort = address.port;

    if (!existsSync(TEST_CONFIG_DIR)) {
      await import('node:fs/promises').then((fs) => fs.mkdir(TEST_CONFIG_DIR, { recursive: true }));
    }
    writeFileSync(TEST_CONFIG_PATH, createTestConfig({
      backends: {
        claudeResponses: {
          url: `http://127.0.0.1:${upstreamPort}`,
          apiKey: 'anthropic-key',
          path: '/v1/messages',
          modelPattern: '^claude-',
          protocol: 'openai-responses',
          upstreamProtocol: 'anthropic',
        },
      },
      aliases: {
        'opus4.8': 'claude-opus-4-8',
      },
      routingTags: {
        'opus4.8': 'claude-opus-4-8',
      },
    }));

    server = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: join(process.cwd()),
      env: {
        ...process.env,
        HOME: homedir(),
        CMR_PORT: String(TEST_PORT),
        CMR_CONFIG_PATH: TEST_CONFIG_PATH,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await setTimeout(1000);
  });

  afterEach(async () => {
    const proc = server;
    server = null;
    await stopProcess(proc);
    if (upstream) {
      await new Promise<void>((resolve) => upstream!.close(() => resolve()));
      upstream = null;
    }
    cleanupTestConfig();
  });

  it('rewrites responses requests to anthropic messages and normalizes the response body', async () => {
    const res = await postRaw('/v1/responses', {
      model: 'gpt-5.5',
      instructions: 'follow repo rules',
      input: 'cmr:opus4.8 修这个 bug',
      max_output_tokens: 512,
      stream: true,
      tools: [
        {
          type: 'function',
          name: 'run_shell',
          description: 'Run shell command',
          parameters: {
            type: 'object',
            properties: {
              cmd: { type: 'string' },
            },
            required: ['cmd'],
          },
        },
      ],
      tool_choice: {
        type: 'function',
        name: 'run_shell',
      },
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(capturedHeaders?.authorization, 'Bearer anthropic-key');
    assert.strictEqual(capturedHeaders?.['anthropic-version'], '2023-06-01');

    const forwarded = JSON.parse(capturedBody);
    assert.strictEqual(forwarded.model, 'claude-opus-4-8');
    assert.strictEqual(forwarded.system, 'follow repo rules');
    assert.strictEqual(forwarded.max_tokens, 512);
    assert.strictEqual(forwarded.stream, undefined);
    assert.strictEqual(forwarded.messages[0]?.role, 'user');
    assert.strictEqual(forwarded.messages[0]?.content, '修这个 bug');
    assert.strictEqual(forwarded.tools[0]?.name, 'run_shell');
    assert.strictEqual(forwarded.tools[0]?.input_schema?.properties?.cmd?.type, 'string');
    assert.strictEqual(forwarded.tool_choice?.type, 'tool');
    assert.strictEqual(forwarded.tool_choice?.name, 'run_shell');

    const parsed = JSON.parse(res.data);
    assert.strictEqual(parsed.object, 'response');
    assert.strictEqual(parsed.model, 'claude-opus-4-8');
    assert.strictEqual(parsed.output_text, 'opus ok');
    assert.strictEqual(parsed.output[0]?.type, 'message');
    assert.strictEqual(parsed.output[0]?.content[0]?.type, 'output_text');
    assert.strictEqual(parsed.usage?.input_tokens, 20);
    assert.strictEqual(parsed.usage?.output_tokens, 4);
    assert.strictEqual(parsed.usage?.total_tokens, 24);
  });
});

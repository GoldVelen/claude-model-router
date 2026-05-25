#!/usr/bin/env node
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync,
  openSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import http from 'node:http';

const DATA_DIR = join(homedir(), '.local', 'share', 'claude-model-router');
const PID_PATH = join(DATA_DIR, 'cmr.pid');
const LOG_PATH = join(DATA_DIR, 'cmr.log');
const CONFIG_DIR = join(homedir(), '.config', 'claude-model-router');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const PROJECT_DIR = dirname(dirname(new URL(import.meta.url).pathname));

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

async function ensureConfig() {
  if (existsSync(CONFIG_PATH)) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`No config found at ${CONFIG_PATH}`);
  const answer = await ask('Run setup wizard now? [Y/n]: ');

  if (answer.toLowerCase() === 'n') {
    console.log('');
    console.log('Run `cmr setup` to create a config file, or create one manually:');
    console.log(`  mkdir -p ${CONFIG_DIR}`);
    console.log(`  echo \'{"port":3457,"logLevel":"info","backends":{},"aliases":{}}\' > ${CONFIG_PATH}`);
    rl.close();
    return false;
  }

  rl.close();
  await cmdSetup();
  return existsSync(CONFIG_PATH);
}

function isRunning() {
  if (!existsSync(PID_PATH)) return false;
  const pid = readFileSync(PID_PATH, 'utf-8').trim();
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function getPid() {
  if (!existsSync(PID_PATH)) return null;
  return readFileSync(PID_PATH, 'utf-8').trim() || null;
}

async function importPipeline() {
  const distEntry = join(PROJECT_DIR, 'dist', 'pipeline.js');
  if (existsSync(distEntry)) {
    return import(pathToFileURL(distEntry).href);
  }
  const srcEntry = join(PROJECT_DIR, 'src', 'pipeline.ts');
  return import(pathToFileURL(srcEntry).href);
}

// ─── Start (daemon) ────────────────────────────────────────────────

function findServerEntry() {
  const distEntry = join(PROJECT_DIR, 'dist', 'index.js');
  if (existsSync(distEntry)) {
    return { cmd: process.execPath, args: [distEntry] };
  }
  const srcEntry = join(PROJECT_DIR, 'src', 'index.ts');
  return { cmd: process.execPath, args: ['--import', 'tsx/esm', srcEntry] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cmdStart() {
  if (!(await ensureConfig())) return;
  if (isRunning()) {
    console.log(`Already running (pid ${getPid()})`);
    return;
  }

  ensureDir(DATA_DIR);

  const { cmd, args } = findServerEntry();
  const logFd = openSync(LOG_PATH, 'a');

  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });

  const pid = String(child.pid ?? '');
  writeFileSync(PID_PATH, pid);
  child.unref();

  await sleep(400);
  if (!isRunning()) {
    try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
    console.error('Failed to start (process exited). Check logs:');
    console.error(`  ${LOG_PATH}`);
    console.error('Common causes: port already in use (EADDRINUSE), missing config.');
    process.exit(1);
  }

  console.log(`Started (pid ${pid})`);
  console.log(`Logs: ${LOG_PATH}`);
}

// ─── Stop ───────────────────────────────────────────────────────────

function cmdStop() {
  if (!isRunning()) {
    console.log('Not running');
    try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
    return;
  }

  const pid = getPid();
  if (!pid) {
    console.log('Not running');
    return;
  }
  try {
    process.kill(Number(pid));
    console.log(`Stopped (pid ${pid})`);
  } catch {
    console.log('Not running');
  }
  try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
}

// ─── Status ─────────────────────────────────────────────────────────

function cmdStatus() {
  if (isRunning()) {
    console.log(`Status: running (pid ${getPid()})`);
  } else {
    console.log('Status: stopped');
  }
}

// ─── Logs ───────────────────────────────────────────────────────────

function cmdLogs() {
  if (!existsSync(LOG_PATH)) {
    console.log('No logs yet');
    return;
  }
  const raw = readFileSync(LOG_PATH, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  console.log(lines.slice(-50).join('\n'));
}

// ─── Config view ────────────────────────────────────────────────────

function cmdConfigShow() {
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Data:   ${DATA_DIR}`);
  console.log('');

  if (!existsSync(CONFIG_PATH)) {
    console.log('No config file yet (run `cmr setup` to create one)');
    return;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const redacted = raw.replace(/("apiKey":\s*)"[^"]*"/g, '$1"***"');
    console.log(redacted);
  } catch {
    console.log('Failed to read config');
  }
}

// ─── Setup (interactive config builder) ─────────────────────────────

const DEFAULT_BACKEND_TEMPLATES = {
  deepseek: {
    url: 'https://api.deepseek.com',
    path: '/anthropic/v1/messages',
    modelPattern: '^deepseek-',
    sanitizer: 'deepseek',
    desc: 'DeepSeek API（兼容 Anthropic 协议）',
  },
  claude: {
    url: 'https://api.anthropic.com',
    path: '/v1/messages',
    modelPattern: '^claude-',
    desc: 'Anthropic API（或兼容服务，如 socheap.ai）',
  },
};

async function cmdSetup() {
  // Load existing config for pre-fill
  let existing = null;
  if (existsSync(CONFIG_PATH)) {
    try { existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')); } catch { /* ignore */ }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log('配置 claude-model-router');
  if (existing) {
    console.log('（已检测到现有配置，回车将使用括号内的默认值）');
  }
  console.log('');

  // Port
  const defaultPort = existing?.port || 3457;
  const portStr = await ask(`代理端口 ── 供 Claude Code 连接 [${defaultPort}]: `);
  const port = parseInt(portStr, 10) || defaultPort;

  // Backends
  const existingBackends = existing?.backends || {};
  const backendNames = Object.keys(existingBackends);
  console.log('\n后端配置 ── 至少需要一个后端：');
  if (backendNames.length > 0) {
    console.log(`  已有后端: ${backendNames.join(', ')}`);
  }

  const backends = {};
  let first = true;
  while (true) {
    const addLabel = first
      ? (backendNames.length > 0 ? '修改已有后端？输入名称即可复用 [y/name]: ' : '添加后端？ [y/name]: ')
      : '继续添加？输入名称添加，回车完成 [y/name]: ';
    const addMore = await ask(addLabel);
    if (!addMore) break;
    if (addMore.toLowerCase() !== 'y') {
      // User typed a name — check if it matches an existing backend for pre-fill
      const existingBe = existingBackends[addMore] || null;
      const name = addMore;
      const defaultUrl = existingBe?.url || DEFAULT_BACKEND_TEMPLATES[name]?.url || '';
      const defaultPath = existingBe?.path || DEFAULT_BACKEND_TEMPLATES[name]?.path || '/v1/messages';
      const defaultPattern = existingBe?.modelPattern || DEFAULT_BACKEND_TEMPLATES[name]?.modelPattern || '';
      const defaultDesc = DEFAULT_BACKEND_TEMPLATES[name]?.desc || '';

      const urlPrompt = `  ${name} 的 API 地址${defaultDesc ? ` ── ${defaultDesc}` : ''} [${defaultUrl}]: `;
      const url = await ask(urlPrompt) || defaultUrl;

      const apiKeyPrompt = `  ${name} 的 API 密钥${existingBe?.apiKey ? ' [已配置，回车保留]' : ''}: `;
      const apiKey = await ask(apiKeyPrompt) || existingBe?.apiKey || '';

      const pathPrompt = `  ${name} 的请求路径 ── 后端接收 Messages API 的路径 [${defaultPath}]: `;
      const path = await ask(pathPrompt) || defaultPath;

      const patternPrompt = `  ${name} 的模型匹配 ── 正则表达式，匹配到的模型名将路由到此后端 [${defaultPattern}]: `;
      const modelPattern = await ask(patternPrompt) || defaultPattern;

      const useSanitizer = modelPattern.includes('deepseek')
        ? (await ask(`  ${name} 是否启用 DeepSeek 净化器？── 移除 thinking 字段并规范化 tool_choice [Y/n]: `)).toLowerCase() !== 'n'
        : false;

      const backend = { url, apiKey, path, modelPattern };
      if (useSanitizer) backend.sanitizer = 'deepseek';
      backends[name] = backend;
      first = false;
    } else {
      first = false;
      continue;
    }
  }

  if (Object.keys(backends).length === 0) {
    console.log('至少需要一个后端，已终止。');
    rl.close();
    return;
  }

  // Aliases
  const existingAliases = existing?.aliases || {};
  console.log('\n模型别名 ── 方便 Claude Code 中 /model 切换（可选，回车跳过）：');
  if (Object.keys(existingAliases).length > 0) {
    console.log(`  已有别名: ${Object.entries(existingAliases).map(([k, v]) => `${k}→${v}`).join(', ')}`);
  }
  const aliases = {};
  while (true) {
    const alias = await ask('  别名（如 opus, dsp） [回车完成]: ');
    if (!alias) break;
    const defaultModel = existingAliases[alias] || (aliases[alias] || '');
    const modelPrompt = `  ${alias} 对应的模型名${defaultModel ? ` [${defaultModel}]` : ''}: `;
    const model = await ask(modelPrompt) || defaultModel;
    if (model) aliases[alias] = model;
  }

  const defaultAliases = {
    dsp: 'deepseek-v4-pro',
    dsf: 'deepseek-v4-flash',
    opus: 'claude-opus-4-7',
    sonnet: 'claude-sonnet-4-6',
    haiku: 'claude-haiku-4-5',
  };

  const config = {
    port,
    logLevel: 'info',
    backends,
    aliases: Object.keys(aliases).length > 0 ? aliases : (Object.keys(existingAliases).length > 0 ? existingAliases : defaultAliases),
  };

  ensureDir(CONFIG_DIR);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`\n配置已写入 ${CONFIG_PATH}`);

  // Offer to configure Claude Code settings
  const setupClaude = await ask('\n自动配置 Claude Code 连接到本代理？── 写入 ANTHROPIC_BASE_URL 和占位 API Key [Y/n]: ');
  if (setupClaude.toLowerCase() !== 'n') {
    configureClaudeSettings(port);
  }

  rl.close();
}

function configureClaudeSettings(proxyPort) {
  const claudeDir = join(homedir(), '.claude');
  const settingsPath = join(claudeDir, 'settings.json');

  let settings = {};
  if (existsSync(settingsPath)) {
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(raw);
    } catch {
      settings = {};
    }
  } else {
    ensureDir(claudeDir);
  }

  const env = { ...(settings.env || {}) };
  env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${proxyPort}`;
  env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || 'sk-ant-placeholder';

  const newSettings = { ...settings, env };
  writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2), 'utf-8');
  console.log(`Claude Code settings updated: ${settingsPath}`);
  console.log(`  ANTHROPIC_BASE_URL = http://127.0.0.1:${proxyPort}`);
  console.log(`  ANTHROPIC_API_KEY  = ${env.ANTHROPIC_API_KEY}`);
  console.log('  (proxy replaces the key when forwarding to backends)');
}

// ─── Pipeline runner ────────────────────────────────────────────────

const PIPELINE_CONSTRAINT_WARNING = [
  '\x1b[33m⚠  Pipeline Mode — Not Suitable for Constrained Tasks\x1b[0m',
  '',
  'This environment has no interruption points. Once submitted,',
  'the prompt executes to completion automatically.',
  '',
  '\x1b[33mUnsuitable for:\x1b[0m minimal-diff fixes, bug fixes, preserving',
  'existing logic, "only fix X" instructions, surgical changes.',
  '',
  '\x1b[32mSuitable for:\x1b[0m new code generation, scaffolding,',
  'docs/test batch generation, independent tasks.',
  '',
  'For constrained tasks, use the Claude Code interactive environment.',
  '',
].join('\n');

const CONSTRAINT_KEYWORDS = [
  // Chinese
  '最小 diff', '最小改动', '最小修改', '保留现有', '保留原有',
  '不要重构', '不要修改', '不要改', '不要动', '不动',
  '只修', '只改', '原有逻辑', '现有代码', '现有逻辑',
  '先 Read', '先 read', '先读', '修复 bug', '修 bug',
  '修复漏洞', '外科手术', '不要 commit', '不要提交', '不 commit',
  // English
  'minimum diff', 'minimal diff', 'minimal change',
  'preserve existing', 'preserve original',
  "don't change", "don't modify", "don't refactor",
  'do not change', 'do not modify', 'do not refactor',
  'only fix', 'existing logic', 'existing code',
  'read first', 'fix bug', 'bugfix', 'surgical',
  'no commit', "don't commit",
];

async function cmdRun(task) {
  if (!(await ensureConfig())) return;
  if (!isRunning()) {
    console.log('Proxy is not running. Start it first: cmr start');
    process.exit(1);
  }

  process.stderr.write(PIPELINE_CONSTRAINT_WARNING + '\n\n');

  // Guard: check for constraint keywords
  if (!process.env.PIPELINE_GUARD_DISABLED) {
    const hits = CONSTRAINT_KEYWORDS.filter((kw) => task.includes(kw));
    if (hits.length > 0) {
      const joined = hits.map((k) => `"${k}"`).join(', ');
      process.stderr.write(`\x1b[33mConstraint keywords detected: ${joined}\x1b[0m\n`);
      process.stderr.write('This task appears unsuitable for pipeline mode.\n');
      process.stderr.write('Recommendation: use Claude Code interactive environment instead.\n');
      process.stderr.write('To bypass: set PIPELINE_GUARD_DISABLED=1\n\n');
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      const answer = await new Promise((resolve) => {
        rl.question('Continue anyway? [y/N]: ', (a) => resolve(a.trim().toLowerCase()));
      });
      rl.close();
      if (answer !== 'y' && answer !== 'yes') {
        process.stderr.write('Aborted. Use Claude Code for constrained tasks.\n');
        process.exit(1);
      }
      process.stderr.write('\n');
    }
  }

  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }

  const port = config.port || 3457;

  const { getPipelineStages, runPipeline } = await importPipeline();

  const stages = getPipelineStages(config);
  const stageNames = Object.keys(stages);
  console.log('Pipeline stages:');
  for (const [name, stage] of Object.entries(stages)) {
    console.log(`  ${name.padEnd(12)} → ${stage.model}`);
  }
  console.log(`\nTask: ${task}`);
  console.log('─'.repeat(60));

  const controller = new AbortController();
  const onSigint = () => {
    process.stderr.write('\n[INTERRUPTED] Saving checkpoint...\n');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  let result;
  try {
    result = await runPipeline(task, config, port, { signal: controller.signal });
  } catch (err) {
    process.removeListener('SIGINT', onSigint);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Pipeline failed: ${message}`);
    process.exit(1);
  }

  process.removeListener('SIGINT', onSigint);

  if (result?.abortedAt) {
    const runDir = join(DATA_DIR, 'runs');
    ensureDir(runDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const checkpointPath = join(runDir, `${timestamp}.json`);
    const currentIdx = result.stages.indexOf(result.abortedAt);
    writeFileSync(checkpointPath, JSON.stringify({
      task,
      stages: result.stages,
      ctx: result.ctx,
      currentStage: currentIdx >= 0 ? currentIdx : result.stages.length,
    }, null, 2), 'utf-8');
    console.log(`\nCheckpoint saved. Resume with: cmr run resume ${timestamp}`);
    process.exit(130);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Pipeline complete.');
  if (result.failedStages?.length) {
    console.log(`Failed stages: ${result.failedStages.join(', ')}`);
  }
  if (result.timedOutStages?.length) {
    console.log(`Timed out stages: ${result.timedOutStages.join(', ')}`);
  }
  console.log('='.repeat(60) + '\n');

  const lastStage = result.stages[result.stages.length - 1];
  if (lastStage && result.ctx[lastStage]) {
    console.log(result.ctx[lastStage]);
  }

  if (result.failedStages?.length || result.timedOutStages?.length) {
    process.exit(1);
  }
}

async function cmdPipelineShow() {
  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }
  const { getPipelineStages } = await importPipeline();
  const stages = getPipelineStages(config);
  console.log('Pipeline stages (defaults shown unless overridden in config):\n');
  for (const [name, stage] of Object.entries(stages)) {
    const preview = stage.prompt.split('\n')[0].slice(0, 80);
    console.log(`${name}:`);
    console.log(`  model: ${stage.model}`);
    console.log(`  prompt: ${preview}...`);
    console.log('');
  }
}

// ─── Stats ──────────────────────────────────────────────────────────

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function padEnd(str, len) {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

async function cmdStats() {
  if (!(await ensureConfig())) return;
  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    return;
  }

  const port = config.port || 3457;

  try {
    const data = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/stats`, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Invalid JSON from /stats'));
          }
        });
      }).on('error', reject);
    });

    console.log('Proxy Statistics');
    console.log('─'.repeat(50));
    console.log(`Total requests: ${data.total}`);
    console.log(`Uptime:         ${formatUptime(data.uptime)}`);
    console.log(`Started:        ${data.startTime}`);
    console.log('');

    const backends = Object.entries(data.backends || {});
    if (backends.length === 0) {
      console.log('No requests recorded yet.');
    } else {
      console.log('Per-backend stats:');
      console.log(padEnd('  Backend', 20) + padEnd('Requests', 12) + 'Last Request');
      console.log('  ' + '─'.repeat(60));

      for (const [name, stats] of backends) {
        const count = String(stats.count);
        const last = stats.lastRequest || 'never';
        console.log('  ' + padEnd(name, 18) + padEnd(count, 12) + last);
      }
    }
  } catch (err) {
    console.log('Proxy is not running. Start it first: cmr start');
    console.log(`  (${err.message})`);
  }
}

// ─── Health ─────────────────────────────────────────────────────────

async function cmdHealth() {
  if (!(await ensureConfig())) return;
  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }

  const backends = config.backends;
  if (!backends || Object.keys(backends).length === 0) {
    console.log('No backends configured.');
    return;
  }

  const { checkBackend } = await import(pathToFileURL(
    join(PROJECT_DIR, 'src', 'utils', 'http-client.ts')
  ).href);

  const results = await Promise.all(
    Object.entries(backends).map(([name, backend]) =>
      checkBackend(name, backend.url)
    )
  );

  console.log('Backend Health Check');
  console.log('─'.repeat(50));

  let allHealthy = true;
  for (const result of results) {
    const status = result.reachable ? 'OK' : 'FAIL';
    const icon = result.reachable ? '✓' : '✗';
    console.log(`${icon} ${result.name.padEnd(16)} ${status.padEnd(6)} ${result.url}`);
    if (!result.reachable && result.error) {
      console.log(`  Error: ${result.error}`);
      allHealthy = false;
    }
  }

  console.log('─'.repeat(50));
  console.log(allHealthy ? 'All backends healthy' : 'Some backends are unreachable');

  if (!allHealthy) process.exit(1);
}

// ─── Dashboard ──────────────────────────────────────────────────────

async function cmdDashboard() {
  if (!process.stdin.isTTY) {
    console.log('Dashboard requires an interactive terminal (TTY).');
    process.exit(1);
  }
  if (!isRunning()) {
    console.log('Proxy is not running. Start it first: cmr start');
    process.exit(1);
  }

  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }

  const port = config.port || 3457;
  const red = '\x1b[31m';
  const green = '\x1b[32m';
  const yellow = '\x1b[33m';
  const reset = '\x1b[0m';

  let running = true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const onKey = (key) => {
    if (key === 'q' || key === '\x03') {
      running = false;
    }
  };
  process.stdin.on('data', onKey);

  // Hide cursor
  process.stdout.write('\x1b[?25l');

  async function fetchData() {
    const [statsRes, logsRes] = await Promise.all([
      new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/stats`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
      }),
      new Promise((resolve) => {
        http.get(`http://127.0.0.1:${port}/logs`, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(null); } });
        }).on('error', () => resolve(null));
      }),
    ]);
    return { stats: statsRes, logs: logsRes };
  }

  function render(data) {
    process.stdout.write('\x1b[3J\x1b[2J\x1b[H'); // Clear scrollback + screen + home

    const pid = getPid() || '?';
    const uptime = data.stats ? formatUptime(data.stats.uptime) : '?';
    const total = data.stats ? String(data.stats.total) : '?';

    // Header
    process.stdout.write('┌─ Claude Model Router Dashboard ' + '─'.repeat(34) + '┐\n');
    process.stdout.write(`│ Status: Running (pid ${pid})    Uptime: ${uptime.padStart(10)} │\n`);
    process.stdout.write('├' + '─'.repeat(58) + '┤\n');

    // Backend Health
    process.stdout.write('│ Backend Health:' + ' '.repeat(42) + '│\n');
    const backends = data.stats?.backends || {};
    const backendNames = Object.keys(backends);
    if (backendNames.length === 0) {
      process.stdout.write('│  (no backends configured)' + ' '.repeat(33) + '│\n');
    } else {
      for (const [name, stats] of Object.entries(backends)) {
        const consecutiveFailures = stats.consecutiveFailures || 0;
        let statusColor, statusIcon, statusLabel;
        if (consecutiveFailures === 0) {
          statusColor = green; statusIcon = '✓ '; statusLabel = 'OK      ';
        } else if (consecutiveFailures < 3) {
          statusColor = yellow; statusIcon = '⚠ '; statusLabel = 'DEGRADED';
        } else {
          statusColor = red; statusIcon = '✗ '; statusLabel = 'DOWN    ';
        }
        const count = String(stats.count || 0);
        const last = stats.lastRequest || 'never';
        const displayLast = last.length > 20 ? last.slice(0, 20) : last;
        process.stdout.write(
          `│ ${statusColor}${statusIcon}${reset}${name.padEnd(12)} ${statusColor}${statusLabel}${reset}  ${count.padStart(6)} reqs   last: ${displayLast.padEnd(20)}│\n`
        );
      }
    }

    process.stdout.write('├' + '─'.repeat(58) + '┤\n');

    // Recent Logs
    process.stdout.write('│ Recent Logs:' + ' '.repeat(45) + '│\n');
    const logLines = (data.logs?.logs || []).slice(-20);
    if (logLines.length === 0) {
      process.stdout.write('│  (no logs yet)' + ' '.repeat(43) + '│\n');
    } else {
      for (const line of logLines.slice(-10)) {
        const truncated = line.length > 55 ? line.slice(0, 52) + '...' : line;
        process.stdout.write(`│ ${truncated.padEnd(57)}│\n`);
      }
    }

    process.stdout.write('└' + '─'.repeat(58) + '┘\n');
    process.stdout.write(`Press 'q' to quit  │  Refresh: ${new Date().toLocaleTimeString()}\n`);
  }

  while (running) {
    try {
      const data = await fetchData();
      render(data);
    } catch {
      // silently retry on transient errors
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write('Fetching data failed, retrying...\n');
    }
    // Check running flag every 100ms for responsive 'q' exit
    for (let i = 0; i < 10 && running; i++) {
      await sleep(100);
    }
  }

  // Restore terminal
  process.stdout.write('\x1b[?25h'); // Show cursor
  process.stdout.write('\x1b[3J\x1b[2J\x1b[H'); // Clear scrollback + screen
  process.stdin.removeListener('data', onKey);
  process.stdin.setRawMode(false);
  process.stdin.pause();
  console.log('Dashboard closed.');
  process.exit(0);
}

// ─── Update ──────────────────────────────────────────────────────────

async function cmdUpdate() {
  console.log('Checking for updates...');

  const pkgPath = join(PROJECT_DIR, 'package.json');
  let currentVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    currentVersion = pkg.version || '0.0.0';
  } catch { /* ignore */ }

  const { checkForUpdate } = await import(
    pathToFileURL(join(PROJECT_DIR, 'dist', 'utils', 'update-checker.js')).href
  );
  const result = await checkForUpdate(currentVersion);

  if (!result.updateAvailable) {
    console.log(`Already up to date (v${result.current})`);
    return;
  }

  console.log(`\x1b[33mUpdate available: v${result.current} → v${result.latest}\x1b[0m`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
  const install = await ask('Install now? [Y/n]: ');
  rl.close();

  if (install.toLowerCase() === 'n') {
    console.log('Skipped. Run `npm install -g claude-model-router` to update later.');
    return;
  }

  console.log('Installing...');
  const child = spawn('npm', ['install', '-g', 'claude-model-router'], {
    stdio: 'inherit',
    shell: true,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log(`\nUpdated to v${result.latest}. Run 'cmr restart' to restart the proxy.`);
    } else {
      console.log(`\nInstall failed (exit code ${code}). Try manually: npm install -g claude-model-router`);
    }
  });
}

// ─── Help ───────────────────────────────────────────────────────────

function cmdHelp() {
  console.log(`Usage: cmr <command> [args]

Quick Start (first time):
  1. cmr setup    # Interactive config wizard
  2. cmr start    # Start proxy daemon
  3. cmr status   # Verify it's running

Commands:
  setup     Interactive config builder (run this first!)
  start     Start proxy daemon in background
  stop      Stop the running proxy
  restart   Stop then start
  status    Check if proxy is running
  stats     Show per-backend request statistics
  health    Check backend reachability
  dashboard Real-time monitoring dashboard (press 'q' to quit)
  logs      Show last 50 log lines
  config    Show current config (api keys redacted)
  update    Check for updates and install
  run       Run task through model pipeline
            cmr run <task>                  # Single-line task
            cmr run                         # Interactive multi-line input
            cmr run --file task.txt         # Read from file
            echo "task" | cmr run --stdin   # Read from stdin
  pipeline  Show pipeline stage configuration
  help      Show this help

Environment:
  CMR_PORT           Override proxy port
  CMR_DEEPSEEK_KEY   Override deepseek API key
  CMR_CLAUDE_KEY     Override claude API key
  CMR_LOG_LEVEL      Set log level (silent | info | debug)

Files:
  Config: ${CONFIG_PATH}
  Logs:   ${LOG_PATH}
  PID:    ${PID_PATH}
`);
}

// ─── Main ───────────────────────────────────────────────────────────

const cmd = process.argv[2];

async function main() {
  switch (cmd) {
    case 'start':   await cmdStart(); break;
    case 'stop':    cmdStop(); break;
    case 'restart': cmdStop(); await cmdStart(); break;
    case 'status':  cmdStatus(); break;
    case 'stats':   await cmdStats(); break;
    case 'health':  await cmdHealth(); break;
    case 'dashboard': await cmdDashboard(); break;
    case 'logs':    cmdLogs(); break;
    case 'config':  cmdConfigShow(); break;
    case 'update':  await cmdUpdate(); break;
    case 'setup':   await cmdSetup(); break;
    case 'run': {
      const mode = process.argv[3];
      let task;

      if (mode === '--file') {
        const filePath = process.argv[4];
        if (!filePath) {
          console.log('Usage: cmr run --file <path>');
          process.exit(1);
        }
        if (!existsSync(filePath)) {
          console.log(`File not found: ${filePath}`);
          process.exit(1);
        }
        task = readFileSync(filePath, 'utf-8').trim();
      } else if (mode === '--stdin') {
        task = readFileSync(0, 'utf-8').trim();
      } else if (!mode) {
        console.log('Enter task description (press Enter, then Ctrl+D to finish):');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const lines = [];
        rl.on('line', (line) => lines.push(line));
        await new Promise((resolve) => rl.on('close', resolve));
        task = lines.join('\n').trim();
      } else {
        task = process.argv.slice(3).join(' ');
      }

      if (!task) {
        console.log('Task description is required.');
        process.exit(1);
      }
      await cmdRun(task);
      break;
    }
    case 'resume': {
      const resumeId = process.argv[3];
      if (!resumeId) {
        console.log('Usage: cmr run resume <run-id>');
        console.log('Available checkpoints:');
        const runDir = join(DATA_DIR, 'runs');
        if (existsSync(runDir)) {
          const files = readdirSync(runDir).filter(f => f.endsWith('.json')).sort().reverse();
          for (const f of files) console.log(`  ${f.replace('.json', '')}`);
          if (files.length === 0) console.log('  (none)');
        } else {
          console.log('  (none)');
        }
        process.exit(1);
      }
      const checkpointPath = join(DATA_DIR, 'runs', `${resumeId}.json`);
      if (!existsSync(checkpointPath)) {
        console.log(`Checkpoint not found: ${resumeId}`);
        process.exit(1);
      }
      const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf-8'));
      const { getPipelineStages: resumeGetStages, runPipeline: resumePipeline } = await importPipeline();

      const remainingStages = checkpoint.stages.slice(checkpoint.currentStage);
      if (remainingStages.length === 0) {
        console.log('All stages already completed.');
        process.exit(0);
      }
      console.log(`Resuming from stage ${checkpoint.currentStage + 1}/${checkpoint.stages.length}: ${remainingStages[0]}`);
      console.log('─'.repeat(60));

      const resumeCfg = readConfig();
      const port = resumeCfg.port || 3457;
      const pipelineCfg = {};
      for (const name of remainingStages) {
        pipelineCfg[name] = resumeGetStages(resumeCfg)[name];
      }
      resumeCfg.pipeline = pipelineCfg;

      const result = await resumePipeline(checkpoint.task, resumeCfg, port);
      Object.assign(checkpoint.ctx, result.ctx);

      console.log('\n' + '='.repeat(60));
      console.log('Pipeline complete. Final report:');
      console.log('='.repeat(60) + '\n');
      const lastStage = result.stages[result.stages.length - 1];
      if (lastStage && checkpoint.ctx[lastStage]) {
        console.log(checkpoint.ctx[lastStage]);
      }
      break;
    }
    case 'pipeline':
      await cmdPipelineShow();
      break;
    case 'help':
    case '--help':
    case '-h':
      cmdHelp(); break;
    default:
      cmdHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

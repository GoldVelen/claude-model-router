#!/usr/bin/env node
import {
  existsSync, readFileSync, writeFileSync, mkdirSync,
  openSync,
} from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline';

const DATA_DIR = join(homedir(), '.local', 'share', 'claude-model-router');
const PID_PATH = join(DATA_DIR, 'cmr.pid');
const LOG_PATH = join(DATA_DIR, 'cmr.log');
const CONFIG_DIR = join(homedir(), '.config', 'claude-model-router');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const PROJECT_DIR = dirname(dirname(new URL(import.meta.url).pathname));

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readConfig(): Record<string, unknown> | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isRunning(): boolean {
  if (!existsSync(PID_PATH)) return false;
  const pid = readFileSync(PID_PATH, 'utf-8').trim();
  if (!pid) return false;
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function getPid(): string | null {
  if (!existsSync(PID_PATH)) return null;
  return readFileSync(PID_PATH, 'utf-8').trim() || null;
}

// ─── Start (daemon) ────────────────────────────────────────────────

function findServerEntry(): { cmd: string; args: string[] } {
  const distEntry = join(PROJECT_DIR, 'dist', 'server.js');
  if (existsSync(distEntry)) {
    return { cmd: process.execPath, args: [distEntry] };
  }
  const srcEntry = join(PROJECT_DIR, 'src', 'index.ts');
  return { cmd: process.execPath, args: ['--import', 'tsx/esm', srcEntry] };
}

function cmdStart(): void {
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

  console.log(`Started (pid ${pid})`);
  console.log(`Logs: ${LOG_PATH}`);
}

// ─── Stop ───────────────────────────────────────────────────────────

function cmdStop(): void {
  if (!isRunning()) {
    console.log('Not running');
    try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
    return;
  }

  const pid = getPid()!;
  try {
    process.kill(Number(pid));
    console.log(`Stopped (pid ${pid})`);
  } catch {
    console.log('Not running');
  }
  try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
}

// ─── Status ─────────────────────────────────────────────────────────

function cmdStatus(): void {
  if (isRunning()) {
    console.log(`Status: running (pid ${getPid()})`);
  } else {
    console.log('Status: stopped');
  }
}

// ─── Logs ───────────────────────────────────────────────────────────

function cmdLogs(): void {
  if (!existsSync(LOG_PATH)) {
    console.log('No logs yet');
    return;
  }
  const raw = readFileSync(LOG_PATH, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  console.log(lines.slice(-50).join('\n'));
}

// ─── Config view ────────────────────────────────────────────────────

function cmdConfigShow(): void {
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

async function cmdSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  console.log('Configure claude-model-router\n');

  const portStr = await ask('Proxy port [3457]: ');
  const port = parseInt(portStr, 10) || 3457;

  const backends: Record<string, Record<string, unknown>> = {};
  console.log('\nAdd backends (at least one required):');

  let first = true;
  while (true) {
    const addMore = first || (await ask('\nAdd another backend? [y/N]: ')).toLowerCase() === 'y';
    if (!addMore) break;
    first = false;

    const name = await ask('  Backend name (e.g. deepseek, claude): ');
    const url = await ask('  URL (e.g. https://api.deepseek.com): ');
    const apiKey = await ask('  API key: ');
    const path = await ask('  API path [/v1/messages]: ') || '/v1/messages';
    const modelPattern = await ask('  Model pattern regex (e.g. ^deepseek-): ');
    const useSanitizer = modelPattern.includes('deepseek')
      ? (await ask('  Use deepseek sanitizer? [Y/n]: ')).toLowerCase() !== 'n'
      : false;

    const backend: Record<string, unknown> = { url, apiKey, path, modelPattern };
    if (useSanitizer) backend['sanitizer'] = 'deepseek';
    backends[name] = backend;
  }

  if (Object.keys(backends).length === 0) {
    console.log('At least one backend is required. Aborting.');
    rl.close();
    return;
  }

  console.log('\nModel aliases (optional, press Enter to skip):');
  const aliases: Record<string, string> = {};
  while (true) {
    const alias = await ask('  Alias (e.g. opus, dsp) [done]: ');
    if (!alias) break;
    const model = await ask('  Model name (e.g. claude-opus-4-7): ');
    if (model) aliases[alias] = model;
  }

  const config = {
    port,
    logLevel: 'info',
    backends,
    aliases: Object.keys(aliases).length > 0 ? aliases : {
      dsp: 'deepseek-v4-pro',
      dsf: 'deepseek-v4-flash',
      opus: 'claude-opus-4-7',
      sonnet: 'claude-sonnet-4-6',
      haiku: 'claude-haiku-4-5',
    },
  };

  ensureDir(CONFIG_DIR);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  console.log(`\nConfig written to ${CONFIG_PATH}`);
  rl.close();
}

// ─── Pipeline runner ────────────────────────────────────────────────

async function cmdRun(task: string): Promise<void> {
  if (!isRunning()) {
    console.log('Proxy is not running. Start it first: cmr start');
    process.exit(1);
  }

  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }

  const port = (config['port'] as number) || 3457;

  const { getPipelineStages, runPipeline } = await import('../src/pipeline.js');

  const stages = getPipelineStages(config as Parameters<typeof getPipelineStages>[0]);
  console.log('Pipeline stages:');
  for (const [name, stage] of Object.entries(stages)) {
    console.log(`  ${name.padEnd(12)} → ${(stage as { model: string }).model}`);
  }
  console.log(`\nTask: ${task}`);
  console.log('─'.repeat(60));

  try {
    const result = await runPipeline(task, config as Parameters<typeof runPipeline>[1], port);

    console.log('\n' + '='.repeat(60));
    console.log('Pipeline complete. Final report:');
    console.log('='.repeat(60) + '\n');

    const lastStage = result.stages[result.stages.length - 1];
    if (lastStage && result.ctx[lastStage]) {
      console.log(result.ctx[lastStage]);
    }
  } catch (err) {
    console.error(`Pipeline failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function cmdPipelineShow(): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.log('No config found. Run `cmr setup` first.');
    process.exit(1);
  }
  const { getPipelineStages } = await import('../src/pipeline.js');
  const stages = getPipelineStages(config as Parameters<typeof getPipelineStages>[0]);
  console.log('Pipeline stages (defaults shown unless overridden in config):\n');
  for (const [name, stage] of Object.entries(stages)) {
    const s = stage as { model: string; prompt: string };
    const preview = s.prompt.split('\n')[0].slice(0, 80);
    console.log(`${name}:`);
    console.log(`  model: ${s.model}`);
    console.log(`  prompt: ${preview}...`);
    console.log('');
  }
}

// ─── Help ───────────────────────────────────────────────────────────

function cmdHelp(): void {
  console.log(`Usage: cmr <command> [args]

Commands:
  start     Start proxy daemon in background
  stop      Stop the running proxy
  restart   Stop then start
  status    Check if proxy is running
  logs      Show last 50 log lines
  config    Show current config (api keys redacted)
  setup     Interactive config builder
  run       Run task through model pipeline
            cmr run <task description>
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

async function main(): Promise<void> {
  switch (cmd) {
    case 'start':   cmdStart(); break;
    case 'stop':    cmdStop(); break;
    case 'restart': cmdStop(); cmdStart(); break;
    case 'status':  cmdStatus(); break;
    case 'logs':    cmdLogs(); break;
    case 'config':  cmdConfigShow(); break;
    case 'setup':   await cmdSetup(); break;
    case 'run': {
      const task = process.argv.slice(3).join(' ');
      if (!task) {
        console.log('Usage: cmr run <task description>');
        console.log('Example: cmr run "build a REST API for todos"');
        process.exit(1);
      }
      await cmdRun(task);
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

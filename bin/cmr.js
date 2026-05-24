#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.local', 'share', 'claude-model-router');
const PID_PATH = join(DATA_DIR, 'cmr.pid');
const LOG_PATH = join(DATA_DIR, 'cmr.log');
const CONFIG_DIR = join(homedir(), '.config', 'claude-model-router');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const PROJECT_DIR = new URL('..', import.meta.url).pathname;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function cmdStart() {
  if (existsSync(PID_PATH)) {
    const pid = readFileSync(PID_PATH, 'utf-8').trim();
    try {
      process.kill(Number(pid), 0);
      console.log(`Already running (pid ${pid})`);
      return;
    } catch { /* stale pid */ }
  }

  ensureDir(DATA_DIR);
  const entry = join(PROJECT_DIR, 'src', 'index.ts');
  const child = spawn('npx', ['tsx', entry], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });

  child.stdout?.on('data', (d) => appendFileSync(LOG_PATH, d));
  child.stderr?.on('data', (d) => appendFileSync(LOG_PATH, d));

  writeFileSync(PID_PATH, String(child.pid ?? ''));
  child.unref();
  console.log(`Started (pid ${child.pid})`);
}

function cmdStop() {
  if (!existsSync(PID_PATH)) {
    console.log('Not running');
    return;
  }

  const pid = readFileSync(PID_PATH, 'utf-8').trim();
  try {
    process.kill(Number(pid));
    console.log(`Stopped (pid ${pid})`);
  } catch {
    console.log('Not running');
  }

  try { writeFileSync(PID_PATH, ''); } catch { /* ignore */ }
}

function cmdStatus() {
  if (!existsSync(PID_PATH)) {
    console.log('Status: stopped');
    return;
  }

  const pid = readFileSync(PID_PATH, 'utf-8').trim();
  try {
    process.kill(Number(pid), 0);
    console.log(`Status: running (pid ${pid})`);
  } catch {
    console.log('Status: stopped (stale pid)');
  }
}

function cmdLogs() {
  if (!existsSync(LOG_PATH)) {
    console.log('No logs yet');
    return;
  }

  const lines = readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean);
  const tail = lines.slice(-50);
  console.log(tail.join('\n'));
}

function cmdConfig() {
  console.log(`Config: ${CONFIG_PATH}`);
  console.log(`Data:   ${DATA_DIR}`);
  console.log('');

  if (!existsSync(CONFIG_PATH)) {
    console.log('No config file yet (will use defaults)');
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

const cmd = process.argv[2];
switch (cmd) {
  case 'start':  cmdStart(); break;
  case 'stop':   cmdStop(); break;
  case 'restart': cmdStop(); cmdStart(); break;
  case 'status': cmdStatus(); break;
  case 'logs':   cmdLogs(); break;
  case 'config': cmdConfig(); break;
  default:
    console.log('Usage: cmr <start|stop|restart|status|logs|config>');
    process.exit(1);
}

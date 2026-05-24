import { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const LOG_PATH = join(homedir(), '.local', 'share', 'claude-model-router', 'cmr.log');

export function handleLogsRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';
  if (req.method !== 'GET' || url !== '/logs') return false;

  let logs: string[] = [];
  if (existsSync(LOG_PATH)) {
    const raw = readFileSync(LOG_PATH, 'utf-8');
    logs = raw.split('\n').filter(Boolean).slice(-20);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ logs }));
  return true;
}

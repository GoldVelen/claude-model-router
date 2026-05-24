import { type IncomingMessage, type ServerResponse } from 'node:http';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getConfig, reloadConfig, getConfigPath } from '../../config.js';
import { validateConfig } from '../../validator.js';
import { redactConfig } from '../../utils/redact.js';

const CONFIG_PATH = getConfigPath();

export function handleApiConfigRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/api/config') {
    const redacted = redactConfig(getConfig() as unknown as Record<string, unknown>);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(redacted));
    return true;
  }

  if (req.method === 'POST' && url === '/api/config') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const newConfig = JSON.parse(body);
        const errors = validateConfig(newConfig);
        if (errors.length > 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, errors }));
          return;
        }
        const dir = join(homedir(), '.config', 'claude-model-router');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
        reloadConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return true;
  }

  return false;
}

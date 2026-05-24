import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type IncomingMessage, type ServerResponse } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(__dirname, '..', '..', 'public', 'index.html');

let htmlCache: string | null = null;

function getHtml(): string {
  if (!htmlCache && existsSync(htmlPath)) {
    htmlCache = readFileSync(htmlPath, 'utf-8');
  }
  return htmlCache ?? '<html><body><h1>index.html not found</h1></body></html>';
}

export function handleWebRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';
  if (req.method !== 'GET' || url !== '/web') return false;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(getHtml());
  return true;
}

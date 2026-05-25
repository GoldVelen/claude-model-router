import { type IncomingMessage, type ServerResponse } from 'node:http';

const PROTECTED = ['/web', '/api/'];

export function getAuthToken(): string | null {
  return process.env['CMR_WEB_AUTH_TOKEN'] || null;
}

export function isPathProtected(url: string): boolean {
  return PROTECTED.some((p) => url === p || url.startsWith(p));
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string') {
    const m = cookie.match(/(?:^|;\s*)cmr_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1] ?? '');
  }
  return null;
}

export function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const required = getAuthToken();
  if (!required) return true;
  const url = req.url ?? '';
  if (!isPathProtected(url)) return true;
  if (url === '/web/login') return true;
  if (extractToken(req) === required) return true;

  const accept = req.headers['accept'] ?? '';
  if (typeof accept === 'string' && accept.includes('text/html')) {
    res.writeHead(302, { Location: '/web/login' });
    res.end();
  } else {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  }
  return false;
}

import http from 'node:http';
import https from 'node:https';
import { type Config, type Backend } from './types.js';
import { resolveModel, getRouteLabel } from './router.js';
import { sanitizeForDeepseek } from './sanitize.js';

function proxyRequest(
  backend: Backend,
  path: string,
  body: string,
  res: http.ServerResponse,
): void {
  const url = new URL(backend.url);
  const isSecure = url.protocol === 'https:';
  const opts: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (isSecure ? 443 : 80),
    path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${backend.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
  };

  const lib = isSecure ? https : http;
  const proxyReq = lib.request(opts, (proxyRes) => {
    const headers = { ...proxyRes.headers };
    delete headers['content-encoding'];
    res.writeHead(proxyRes.statusCode ?? 502, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'upstream request failed' } }));
  });

  proxyReq.end(body);
}

function logLine(model: string, resolved: string, backend: string): string {
  const label = model === resolved ? model : `${model}→${resolved}`;
  return `[${new Date().toISOString()}] ${label} → ${backend}`;
}

export function createServer(config: Config): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body) as { model?: string };
        const rawModel = parsed.model ?? '';
        const resolvedModel = resolveModel(rawModel, config.aliases);
        const isClaudeRoute = resolvedModel.startsWith('claude-');

        let forwarded = body;
        if (resolvedModel !== rawModel) {
          forwarded = body.replace(`"${rawModel}"`, `"${resolvedModel}"`);
        }

        const backend = isClaudeRoute ? config.backends.claude : config.backends.deepseek;
        const path = isClaudeRoute ? '/v1/messages' : '/anthropic/v1/messages';
        const actualBody = isClaudeRoute ? forwarded : sanitizeForDeepseek(forwarded);

        if (config.logLevel !== 'silent') {
          console.log(logLine(rawModel, resolvedModel, isClaudeRoute ? 'api.anthropic.com' : 'api.deepseek.com'));
        }

        proxyRequest(backend, path, actualBody, res);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
      }
    });
  });
}

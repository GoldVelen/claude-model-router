import http from 'node:http';
import https from 'node:https';
import { type BackendConfig } from './types.js';
import { resolveModel, selectBackend } from './router.js';
import { sanitizeForDeepseek } from './sanitize.js';
import { getConfig } from './config.js';

function proxyRequest(
  backend: BackendConfig,
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

  const startTime = Date.now();
  const lib = isSecure ? https : http;
  const proxyReq = lib.request(opts, (proxyRes) => {
    const latency = Date.now() - startTime;
    const headers = { ...proxyRes.headers };
    delete headers['content-encoding'];

    const config = getConfig();
    if (config.logLevel !== 'silent') {
      const hostname = url.hostname;
      console.log(`[${new Date().toISOString()}] ${hostname} ${proxyRes.statusCode} ${latency}ms`);
    }

    res.writeHead(proxyRes.statusCode ?? 502, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: 'upstream request failed',
        details: err.message,
        backend: backend.url,
      },
    }));
  });

  proxyReq.end(body);
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const config = getConfig();
        const parsed = JSON.parse(body) as { model?: string };
        const rawModel = parsed.model ?? '';
        const resolvedModel = resolveModel(rawModel, config.aliases);

        let forwarded = body;
        if (resolvedModel !== rawModel) {
          forwarded = body.replace(`"${rawModel}"`, `"${resolvedModel}"`);
        }

        const backend = selectBackend(resolvedModel, config.backends);
        if (!backend) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `No backend configured for model: ${resolvedModel}` } }));
          return;
        }

        const path = backend.path || '/v1/messages';
        const actualBody = backend.sanitizer === 'deepseek' ? sanitizeForDeepseek(forwarded) : forwarded;

        if (config.logLevel !== 'silent') {
          const hostname = new URL(backend.url).hostname;
          const label = rawModel === resolvedModel ? rawModel : `${rawModel}→${resolvedModel}`;
          console.log(`[${new Date().toISOString()}] ${label} → ${hostname}`);
        }

        proxyRequest(backend, path, actualBody, res);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
      }
    });
  });
}

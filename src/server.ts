import http from 'node:http';
import https from 'node:https';
import { type BackendConfig } from './types.js';
import { resolveModel, selectBackends } from './router.js';
import { sanitizeForDeepseek } from './sanitize.js';
import { getConfig } from './config.js';
import { handleStatsRoute } from './server/routes/stats.js';
import { handleLogsRoute } from './server/routes/logs.js';
import { handleWebRoute } from './server/routes/web.js';
import { handleApiConfigRoute } from './server/routes/api-config.js';
import { handleApiRunRoute } from './server/routes/api-run.js';
import { handleApiLogsRoute } from './server/routes/api-logs.js';
import { handleLoginRoute } from './server/routes/login.js';
import { checkAuth } from './server/middleware/auth.js';
import { statsMiddleware } from './stats/stats-middleware.js';

type ProxyResult = { success: false; statusCode: number; error?: string }
  | { success: true; res: http.IncomingMessage };

function doProxyRequest(
  backend: BackendConfig,
  path: string,
  body: string,
): Promise<ProxyResult> {
  return new Promise((resolve) => {
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
      const config = getConfig();
      if (config.logLevel !== 'silent') {
        console.log(`[${new Date().toISOString()}] ${url.hostname} ${proxyRes.statusCode} ${latency}ms`);
      }

      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        proxyRes.resume();
        resolve({ success: false, statusCode: proxyRes.statusCode, error: `HTTP ${proxyRes.statusCode}` });
        return;
      }

      resolve({ success: true, res: proxyRes });
    });

    proxyReq.on('error', (err) => {
      const config = getConfig();
      if (config.logLevel !== 'silent') {
        console.log(`[${new Date().toISOString()}] ${url.hostname} ERROR ${err.message}`);
      }
      resolve({ success: false, statusCode: 502, error: err.message });
    });

    proxyReq.end(body);
  });
}

function pipeProxyResponse(proxyRes: http.IncomingMessage, clientRes: http.ServerResponse): void {
  const headers = { ...proxyRes.headers };
  delete headers['content-encoding'];
  clientRes.writeHead(proxyRes.statusCode ?? 502, headers);
  proxyRes.pipe(clientRes);
}

function findBackendName(backend: BackendConfig): string {
  const config = getConfig();
  for (const [name, b] of Object.entries(config.backends)) {
    if (b.url === backend.url) return name;
  }
  return 'unknown';
}

export function createServer(): http.Server {
  return http.createServer((req, res) => {
    if (handleLoginRoute(req, res)) return;
    if (handleStatsRoute(req, res)) return;
    if (handleLogsRoute(req, res)) return;
    if (!checkAuth(req, res)) return;
    if (handleWebRoute(req, res)) return;
    if (handleApiConfigRoute(req, res)) return;
    if (handleApiRunRoute(req, res)) return;
    if (handleApiLogsRoute(req, res)) return;

    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const config = getConfig();
        const parsed = JSON.parse(body) as { model?: string };
        const rawModel = parsed.model ?? '';
        const resolvedModel = resolveModel(rawModel, config.aliases);

        let forwarded = body;
        if (resolvedModel !== rawModel) {
          forwarded = body.replace(`"${rawModel}"`, `"${resolvedModel}"`);
        }

        const backends = selectBackends(resolvedModel, config.backends);
        if (backends.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `No backend configured for model: ${resolvedModel}` } }));
          return;
        }

        const firstHostname = new URL(backends[0]!.url).hostname;
        if (config.logLevel !== 'silent') {
          const label = rawModel === resolvedModel ? rawModel : `${rawModel}→${resolvedModel}`;
          console.log(`[${new Date().toISOString()}] ${label} → ${firstHostname}`);
        }

        const errors: string[] = [];
        for (const backend of backends) {
          const backendName = findBackendName(backend);
          const path = backend.path || '/v1/messages';
          const actualBody = backend.sanitizer === 'deepseek' ? sanitizeForDeepseek(forwarded) : forwarded;

          const result = await doProxyRequest(backend, path, actualBody);

          if (result.success) {
            statsMiddleware(req, res, backendName);
            pipeProxyResponse(result.res, res);
            return;
          }

          const errorMsg = `[${backendName}] ${result.error ?? 'unknown error'}`;
          errors.push(errorMsg);

          if (config.logLevel !== 'silent') {
            const nextIdx = backends.indexOf(backend) + 1;
            if (nextIdx < backends.length) {
              const nextHostname = new URL(backends[nextIdx]!.url).hostname;
              console.log(`[WARN] ${errorMsg}, falling back to ${nextHostname}`);
            } else {
              console.log(`[WARN] ${errorMsg}, no more backends to try`);
            }
          }
        }

        statsMiddleware(req, res, findBackendName(backends[0]!));
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'All backends exhausted',
            details: errors.join('; '),
          },
        }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
      }
    });
  });
}

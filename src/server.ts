import http from 'node:http';
import https from 'node:https';
import { type BackendConfig, type BackendProtocol } from './types.js';
import { getDefaultPath, getUpstreamProtocol, rewriteBodyForCmrTag, selectBackends } from './router.js';
import { sanitizeForDeepseek } from './sanitize.js';
import { prepareProxyRequest, relayProxyResponse } from './openai-compat.js';
import { getConfig } from './config.js';
import { handleStatsRoute } from './server/routes/stats.js';
import { handleLogsRoute } from './server/routes/logs.js';
import { handleWebRoute } from './server/routes/web.js';
import { handleApiConfigRoute } from './server/routes/api-config.js';
import { handleApiRunsRoute } from './server/routes/api-runs.js';
import { handleApiRunRoute } from './server/routes/api-run.js';
import { handleApiLogsRoute } from './server/routes/api-logs.js';
import { handleLoginRoute } from './server/routes/login.js';
import { checkAuth } from './server/middleware/auth.js';
import { statsMiddleware } from './stats/stats-middleware.js';

type ProxyResult = { success: false; statusCode: number; error?: string }
  | { success: true; res: http.IncomingMessage };

function extractUpstreamError(rawBody: string): string {
  if (!rawBody.trim()) return '';

  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const error = parsed['error'];
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const message = (error as Record<string, unknown>)['message'];
      if (typeof message === 'string') return message;
    }
  } catch {
    /* ignore parse errors and fall back to raw text */
  }

  return rawBody.trim();
}

function doProxyRequest(
  backend: BackendConfig,
  path: string,
  body: string,
  forwardedAuthorization?: string,
): Promise<ProxyResult> {
  return new Promise((resolve) => {
    const url = new URL(backend.url);
    const isSecure = url.protocol === 'https:';
    const authorization = backend.forwardAuthorization && forwardedAuthorization
      ? forwardedAuthorization
      : `Bearer ${backend.apiKey}`;
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isSecure ? 443 : 80),
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
      },
    };
    if (getUpstreamProtocol(backend) === 'anthropic') {
      opts.headers = {
        ...opts.headers,
        'anthropic-version': '2023-06-01',
      };
    }

    const startTime = Date.now();
    const lib = isSecure ? https : http;
    const proxyReq = lib.request(opts, (proxyRes) => {
      const latency = Date.now() - startTime;
      const config = getConfig();
      if (config.logLevel !== 'silent') {
        console.log(`[${new Date().toISOString()}] ${url.hostname} ${proxyRes.statusCode} ${latency}ms`);
      }

      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        let upstreamBody = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => (upstreamBody += chunk));
        proxyRes.on('end', () => {
          const details = extractUpstreamError(upstreamBody);
          const suffix = details ? `: ${details}` : '';
          const statusCode = proxyRes.statusCode ?? 502;
          resolve({
            success: false,
            statusCode,
            error: `HTTP ${proxyRes.statusCode}${suffix}`,
          });
        });
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

function findBackendName(backend: BackendConfig): string {
  const config = getConfig();
  for (const [name, b] of Object.entries(config.backends)) {
    if (b === backend) return name;
    if (
      b.url === backend.url
      && b.path === backend.path
      && b.apiKey === backend.apiKey
      && b.modelPattern === backend.modelPattern
      && b.defaultModel === backend.defaultModel
      && b.protocol === backend.protocol
      && b.upstreamProtocol === backend.upstreamProtocol
      && b.sanitizer === backend.sanitizer
    ) {
      return name;
    }
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
    if (handleApiRunsRoute(req, res)) return;
    if (handleApiRunRoute(req, res)) return;
    if (handleApiLogsRoute(req, res)) return;

    if (req.method !== 'POST') {
      res.writeHead(404).end();
      return;
    }

    const requestPath = req.url ?? '';
    const protocol = getRequestProtocol(requestPath);
    if (!protocol) {
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
        const { resolvedModel, rewrittenBody } = rewriteBodyForCmrTag(body, config.routingTags, config.aliases);
        const inboundAuthorization = typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : undefined;

        const backends = selectBackends(resolvedModel, config.backends, protocol);
        if (backends.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: { message: `No backend configured for model: ${resolvedModel} (${protocol})` },
          }));
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
          const prepared = prepareProxyRequest(backend, protocol, rewrittenBody, getDefaultPath(protocol));
          const actualBody = backend.sanitizer === 'deepseek'
            ? sanitizeForDeepseek(prepared.body)
            : prepared.body;

          const result = await doProxyRequest(backend, prepared.path, actualBody, inboundAuthorization);

          if (result.success) {
            statsMiddleware(req, res, backendName);
            await relayProxyResponse(result.res, res, prepared.responseAdapter);
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

function getRequestProtocol(path: string): BackendProtocol | null {
  if (path === '/v1/messages') return 'anthropic';
  if (path === '/v1/chat/completions' || path === '/chat/completions') return 'openai-chat';
  if (path === '/v1/responses' || path === '/responses') return 'openai-responses';
  return null;
}

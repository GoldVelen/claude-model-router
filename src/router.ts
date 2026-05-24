import { type Config, type BackendConfig } from './types.js';
import { sanitizeForDeepseek } from './sanitize.js';

export function resolveModel(raw: string, aliases: Record<string, string>): string {
  return aliases[raw] ?? raw;
}

export function selectBackend(
  model: string,
  backends: Record<string, BackendConfig>,
): BackendConfig | null {
  for (const [, backend] of Object.entries(backends)) {
    if (!backend.modelPattern) continue;

    const regex = new RegExp(backend.modelPattern);
    if (regex.test(model)) {
      return backend;
    }
  }

  const first = Object.values(backends)[0];
  return first || null;
}

export interface RouteResult {
  url: string;
  path: string;
  apiKey: string;
  body: string;
}

export function routeRequest(config: Config, body: string): RouteResult {
  const rawBody = JSON.parse(body) as { model?: string };
  const rawModel = rawBody.model ?? '';
  const resolvedModel = resolveModel(rawModel, config.aliases);

  const backend = selectBackend(resolvedModel, config.backends);
  if (!backend) {
    return { url: '', path: '/v1/messages', apiKey: '', body };
  }

  const forwarded = body.replace(`"${rawModel}"`, `"${resolvedModel}"`);
  const actualBody = backend.sanitizer === 'deepseek' ? sanitizeForDeepseek(forwarded) : forwarded;

  return {
    url: backend.url,
    path: backend.path || '/v1/messages',
    apiKey: backend.apiKey,
    body: actualBody,
  };
}

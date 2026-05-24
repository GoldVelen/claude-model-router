import { type Config, type BackendConfig } from './types.js';
import { sanitizeForDeepseek } from './sanitize.js';
import { isDegraded } from './stats/stats-store.js';

export function resolveModel(raw: string, aliases: Record<string, string>): string {
  return aliases[raw] ?? raw;
}

export function selectBackends(
  model: string,
  backends: Record<string, BackendConfig>,
): readonly BackendConfig[] {
  const matching: BackendConfig[] = [];
  const fallback: BackendConfig[] = [];

  for (const [name, backend] of Object.entries(backends)) {
    if (isDegraded(name)) continue;

    if (backend.modelPattern) {
      const regex = new RegExp(backend.modelPattern);
      if (regex.test(model)) {
        matching.push(backend);
        continue;
      }
    }
    fallback.push(backend);
  }

  return [...matching, ...fallback];
}

export function selectBackend(
  model: string,
  backends: Record<string, BackendConfig>,
): BackendConfig | null {
  const results = selectBackends(model, backends);
  const first = results.find(b => b.modelPattern && new RegExp(b.modelPattern).test(model))
    ?? results[0];
  return first ?? null;
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

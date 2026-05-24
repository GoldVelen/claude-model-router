import { type Config } from './types.js';
import { sanitizeForDeepseek } from './sanitize.js';

export function resolveModel(raw: string, aliases: Record<string, string>): string {
  return aliases[raw] ?? raw;
}

export function isClaude(model: string): boolean {
  return model.startsWith('claude-');
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

  if (isClaude(resolvedModel)) {
    return {
      url: config.backends.claude.url,
      path: '/v1/messages',
      apiKey: config.backends.claude.apiKey,
      body: body.replace(`"${rawModel}"`, `"${resolvedModel}"`),
    };
  }

  const sanitized = body.replace(`"${rawModel}"`, `"${resolvedModel}"`);
  return {
    url: config.backends.deepseek.url,
    path: '/anthropic/v1/messages',
    apiKey: config.backends.deepseek.apiKey,
    body: sanitizeForDeepseek(sanitized),
  };
}

export function getRouteLabel(model: string): string {
  return isClaude(model) ? 'socheap.ai' : 'api.deepseek.com';
}

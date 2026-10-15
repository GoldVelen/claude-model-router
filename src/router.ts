import { type BackendProtocol, type Config, type BackendConfig } from './types.js';
import { sanitizeForDeepseek } from './sanitize.js';
import { isDegraded } from './stats/stats-store.js';
import { prepareProxyRequest } from './openai-compat.js';

const CMR_TAG_PATTERN = /\bcmr:([A-Za-z0-9._-]+)\b/;

export function resolveModel(raw: string, aliases: Record<string, string>): string {
  return aliases[raw] ?? raw;
}

export function getBackendProtocol(backend: BackendConfig): BackendProtocol {
  if (backend.protocol) return backend.protocol;

  const path = backend.path ?? '';
  if (path.includes('/chat/completions')) return 'openai-chat';
  if (path.includes('/responses')) return 'openai-responses';
  return 'anthropic';
}

export function getUpstreamProtocol(backend: BackendConfig): BackendProtocol {
  return backend.upstreamProtocol ?? getBackendProtocol(backend);
}

export function getDefaultPath(protocol: BackendProtocol): string {
  if (protocol === 'openai-chat') return '/v1/chat/completions';
  if (protocol === 'openai-responses') return '/v1/responses';
  return '/v1/messages';
}

function stripCmrTag(text: string): string {
  return text
    .replace(CMR_TAG_PATTERN, '')
    .replace(/^[ \t]*\n/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTaggedModelFromContent(content: unknown): { taggedModel: string | null; cleanedContent: unknown } {
  if (typeof content === 'string') {
    const match = content.match(CMR_TAG_PATTERN);
    if (!match) {
      return { taggedModel: null, cleanedContent: content };
    }

    return {
      taggedModel: match[1] ?? null,
      cleanedContent: stripCmrTag(content),
    };
  }

  if (!Array.isArray(content)) {
    return { taggedModel: null, cleanedContent: content };
  }

  const cleanedContent = content.map((item) => {
    if (!item || typeof item !== 'object') return item;
    return { ...(item as Record<string, unknown>) };
  });

  for (let i = 0; i < cleanedContent.length; i++) {
    const item = cleanedContent[i];
    if (!item || typeof item !== 'object') continue;

    const text = (item as Record<string, unknown>)['text'];
    if (typeof text !== 'string') continue;

    const match = text.match(CMR_TAG_PATTERN);
    if (!match) continue;

    (item as Record<string, unknown>)['text'] = stripCmrTag(text);
    return { taggedModel: match[1] ?? null, cleanedContent };
  }

  return { taggedModel: null, cleanedContent };
}

function extractTaggedModelFromMessages(messages: unknown[]): { taggedModel: string | null; cleanedMessages: unknown[] } {
  const cleanedMessages = messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    return { ...(message as Record<string, unknown>) };
  });

  for (let i = cleanedMessages.length - 1; i >= 0; i--) {
    const message = cleanedMessages[i];
    if (!message || typeof message !== 'object') continue;

    const role = (message as Record<string, unknown>)['role'];
    const content = (message as Record<string, unknown>)['content'];
    if (role !== 'user') continue;

    const extracted = extractTaggedModelFromContent(content);
    if (!extracted.taggedModel) break;

    (message as Record<string, unknown>)['content'] = extracted.cleanedContent;
    return { taggedModel: extracted.taggedModel, cleanedMessages };
  }

  return { taggedModel: null, cleanedMessages };
}

function extractTaggedModelFromInput(input: unknown): { taggedModel: string | null; cleanedInput: unknown } {
  if (typeof input === 'string') {
    const match = input.match(CMR_TAG_PATTERN);
    if (!match) {
      return { taggedModel: null, cleanedInput: input };
    }

    return {
      taggedModel: match[1] ?? null,
      cleanedInput: stripCmrTag(input),
    };
  }

  if (Array.isArray(input)) {
    const cleanedInput = input.map((item) => {
      if (!item || typeof item !== 'object') return item;
      return { ...(item as Record<string, unknown>) };
    });

    for (let i = cleanedInput.length - 1; i >= 0; i--) {
      const item = cleanedInput[i];
      if (!item || typeof item !== 'object') continue;

      const role = (item as Record<string, unknown>)['role'];
      if (role !== 'user') continue;

      const content = (item as Record<string, unknown>)['content'];
      const extracted = extractTaggedModelFromContent(content);
      if (!extracted.taggedModel) break;

      (item as Record<string, unknown>)['content'] = extracted.cleanedContent;
      return { taggedModel: extracted.taggedModel, cleanedInput };
    }

    return { taggedModel: null, cleanedInput };
  }

  if (input && typeof input === 'object') {
    const cleanedInput = { ...(input as Record<string, unknown>) };
    const role = cleanedInput['role'];
    if (role !== 'user') {
      return { taggedModel: null, cleanedInput };
    }

    const extracted = extractTaggedModelFromContent(cleanedInput['content']);
    if (!extracted.taggedModel) {
      return { taggedModel: null, cleanedInput };
    }

    cleanedInput['content'] = extracted.cleanedContent;
    return { taggedModel: extracted.taggedModel, cleanedInput };
  }

  return {
    taggedModel: null,
    cleanedInput: input,
  };
}

export function rewriteBodyForCmrTag(
  body: string,
  routingTags: Record<string, string> | undefined,
  aliases: Record<string, string>,
): { resolvedModel: string; rewrittenBody: string } {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  const rawModel = typeof parsed.model === 'string' ? parsed.model : '';

  let taggedModel: string | null = null;

  if (Array.isArray(parsed.messages)) {
    const extracted = extractTaggedModelFromMessages(parsed.messages);
    taggedModel = extracted.taggedModel;
    parsed.messages = extracted.cleanedMessages;
  } else if (parsed.input !== undefined) {
    const extracted = extractTaggedModelFromInput(parsed.input);
    taggedModel = extracted.taggedModel;
    parsed.input = extracted.cleanedInput;
  }

  const effectiveModel = taggedModel ?? rawModel;
  // Keep prompt routing independent from session aliases while preserving old alias-based tags.
  const taggedResolvedModel = taggedModel ? (routingTags?.[taggedModel] ?? aliases[taggedModel] ?? taggedModel) : null;
  const resolvedModel = taggedResolvedModel ?? resolveModel(effectiveModel, aliases);
  parsed.model = resolvedModel;

  return {
    resolvedModel,
    rewrittenBody: JSON.stringify(parsed),
  };
}

export function selectBackends(
  model: string,
  backends: Record<string, BackendConfig>,
  protocol: BackendProtocol = 'anthropic',
): readonly BackendConfig[] {
  const matching: BackendConfig[] = [];
  const degradedMatching: BackendConfig[] = [];
  const fallback: BackendConfig[] = [];

  for (const [name, backend] of Object.entries(backends)) {
    if (getBackendProtocol(backend) !== protocol) continue;

    const degraded = isDegraded(name);
    const modelPattern = backend.modelPattern;
    const matchesModel = typeof modelPattern === 'string' && new RegExp(modelPattern).test(model);

    if (matchesModel) {
      if (degraded) {
        degradedMatching.push(backend);
      } else {
        matching.push(backend);
      }
      continue;
    }

    if (degraded) continue;

    if (backend.fallback !== false) {
      fallback.push(backend);
    }
  }

  return [...matching, ...degradedMatching, ...fallback];
}

export function selectBackend(
  model: string,
  backends: Record<string, BackendConfig>,
  protocol: BackendProtocol = 'anthropic',
): BackendConfig | null {
  const results = selectBackends(model, backends, protocol);
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

export function routeRequest(
  config: Config,
  body: string,
  protocol: BackendProtocol = 'anthropic',
): RouteResult {
  const { resolvedModel, rewrittenBody } = rewriteBodyForCmrTag(body, config.routingTags, config.aliases);

  const backend = selectBackend(resolvedModel, config.backends, protocol);
  if (!backend) {
    return { url: '', path: getDefaultPath(protocol), apiKey: '', body };
  }

  const prepared = prepareProxyRequest(backend, protocol, rewrittenBody, getDefaultPath(protocol));
  const actualBody = backend.sanitizer === 'deepseek' ? sanitizeForDeepseek(prepared.body) : prepared.body;

  return {
    url: backend.url,
    path: prepared.path,
    apiKey: backend.apiKey,
    body: actualBody,
  };
}

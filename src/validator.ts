export interface ValidationError {
  field: string;
  message: string;
}

const VALID_PROTOCOLS = new Set(['anthropic', 'openai-chat', 'openai-responses']);

export function validateConfig(config: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
    errors.push({ field: 'port', message: 'must be a number between 1-65535' });
  }

  if (!config.backends || typeof config.backends !== 'object') {
    errors.push({ field: 'backends', message: 'must be an object' });
  } else {
    const backends = config.backends as Record<string, Record<string, unknown>>;
    for (const [name, backend] of Object.entries(backends)) {
      if (typeof backend !== 'object' || backend === null) {
        errors.push({ field: `backends.${name}`, message: 'must be an object' });
        continue;
      }

      if (!backend.url || typeof backend.url !== 'string') {
        errors.push({ field: `backends.${name}.url`, message: 'is required' });
      } else {
        try {
          new URL(backend.url as string);
        } catch {
          errors.push({ field: `backends.${name}.url`, message: 'must be a valid URL' });
        }
      }

      if (typeof backend.apiKey !== 'string') {
        errors.push({ field: `backends.${name}.apiKey`, message: 'must be a string' });
      }

      if (backend.defaultModel !== undefined && typeof backend.defaultModel !== 'string') {
        errors.push({ field: `backends.${name}.defaultModel`, message: 'must be a string' });
      }

      if (backend.fallback !== undefined && typeof backend.fallback !== 'boolean') {
        errors.push({ field: `backends.${name}.fallback`, message: 'must be a boolean' });
      }

      if (backend.forwardAuthorization !== undefined && typeof backend.forwardAuthorization !== 'boolean') {
        errors.push({ field: `backends.${name}.forwardAuthorization`, message: 'must be a boolean' });
      }

      if (backend.protocol !== undefined && !VALID_PROTOCOLS.has(String(backend.protocol))) {
        errors.push({
          field: `backends.${name}.protocol`,
          message: 'must be one of anthropic, openai-chat, openai-responses',
        });
      }

      if (backend.upstreamProtocol !== undefined && !VALID_PROTOCOLS.has(String(backend.upstreamProtocol))) {
        errors.push({
          field: `backends.${name}.upstreamProtocol`,
          message: 'must be one of anthropic, openai-chat, openai-responses',
        });
      }
    }

    if (Object.keys(backends).length === 0) {
      errors.push({ field: 'backends', message: 'must have at least one backend' });
    }
  }

  if (config.aliases !== undefined && typeof config.aliases !== 'object') {
    errors.push({ field: 'aliases', message: 'must be an object' });
  }

  if (config.routingTags !== undefined) {
    if (typeof config.routingTags !== 'object' || config.routingTags === null || Array.isArray(config.routingTags)) {
      errors.push({ field: 'routingTags', message: 'must be an object' });
    } else {
      for (const [tag, model] of Object.entries(config.routingTags as Record<string, unknown>)) {
        if (typeof model !== 'string') {
          errors.push({ field: `routingTags.${tag}`, message: 'must be a string' });
        }
      }
    }
  }

  return errors;
}

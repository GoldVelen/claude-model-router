export interface ValidationError {
  field: string;
  message: string;
}

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
    }

    if (Object.keys(backends).length === 0) {
      errors.push({ field: 'backends', message: 'must have at least one backend' });
    }
  }

  if (config.aliases !== undefined && typeof config.aliases !== 'object') {
    errors.push({ field: 'aliases', message: 'must be an object' });
  }

  return errors;
}

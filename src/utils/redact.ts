export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  const src = config['backends'] as Record<string, Record<string, unknown>> | undefined;
  const backends: Record<string, Record<string, unknown>> = {};
  if (!src) return { ...config, backends: {} };
  for (const name of Object.keys(src)) {
    backends[name] = { ...src[name], apiKey: '***' };
  }
  return { ...config, backends };
}

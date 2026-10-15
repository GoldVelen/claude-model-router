import { type Config } from './types.js';
import { getBackendProtocol } from './router.js';

function getBackendHostname(config: Config, model: string, protocol?: string): string {
  const matchingBackend = Object.values(config.backends).find((backend) => {
    if (protocol && getBackendProtocol(backend) !== protocol) return false;
    if (!backend.modelPattern) return false;

    try {
      return new RegExp(backend.modelPattern).test(model);
    } catch {
      return false;
    }
  });

  if (!matchingBackend) return 'unmatched';
  return new URL(matchingBackend.url).hostname;
}

export function formatModelRouteLine(
  label: string,
  model: string,
  config: Config,
  protocol?: string,
): string {
  const hostname = getBackendHostname(config, model, protocol);
  return `    ${label.padEnd(8)} → ${model.padEnd(24)} → ${hostname}`;
}

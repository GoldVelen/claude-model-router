import { checkBackend, type HealthResult } from '../utils/http-client.js';
import { type BackendConfig } from '../types.js';

export async function checkBackends(
  backends: Record<string, BackendConfig>,
): Promise<HealthResult[]> {
  const checks = Object.entries(backends).map(([name, backend]) =>
    checkBackend(name, backend.url),
  );
  return Promise.all(checks);
}

export function printHealth(results: HealthResult[]): void {
  console.log('Backend Health Check');
  console.log('─'.repeat(50));

  let allHealthy = true;
  for (const result of results) {
    const status = result.reachable ? 'OK' : 'FAIL';
    const icon = result.reachable ? '✓' : '✗';
    console.log(`${icon} ${result.name.padEnd(16)} ${status.padEnd(6)} ${result.url}`);
    if (!result.reachable && result.error) {
      console.log(`  Error: ${result.error}`);
      allHealthy = false;
    }
  }

  console.log('─'.repeat(50));
  console.log(allHealthy ? 'All backends healthy' : 'Some backends are unreachable');
}

export async function runHealthCheck(
  backends: Record<string, BackendConfig>,
): Promise<number> {
  const results = await checkBackends(backends);
  printHealth(results);
  return results.every((r) => r.reachable) ? 0 : 1;
}

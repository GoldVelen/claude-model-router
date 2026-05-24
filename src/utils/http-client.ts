import http from 'node:http';
import https from 'node:https';

export interface HealthResult {
  name: string;
  url: string;
  reachable: boolean;
  error: string | null;
}

export function checkBackend(name: string, url: string, timeoutMs = 5000): Promise<HealthResult> {
  return new Promise((resolve) => {
    const parsed = new URL(url + '/v1/messages');
    const isSecure = parsed.protocol === 'https:';
    const lib = isSecure ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isSecure ? 443 : 80),
        path: '/',
        method: 'HEAD',
        timeout: timeoutMs,
      },
      (res) => {
        resolve({ name, url, reachable: true, error: null });
        res.resume();
      },
    );

    req.on('error', (err) => {
      resolve({ name, url, reachable: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ name, url, reachable: false, error: 'timeout' });
    });

    req.end();
  });
}

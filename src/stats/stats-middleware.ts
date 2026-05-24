import { recordRequest, recordFailure } from './stats-store.js';
import { type IncomingMessage, type ServerResponse } from 'node:http';

export function statsMiddleware(
  _req: IncomingMessage,
  res: ServerResponse,
  backendName: string,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalWriteHead = res.writeHead.bind(res) as any;
  let statusCode = 200;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.writeHead = function (this: ServerResponse, ...args: any[]): ServerResponse {
    statusCode = typeof args[0] === 'number' ? args[0] : statusCode;
    return originalWriteHead.apply(this, args);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalEnd = res.end.bind(res) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.end = function (this: ServerResponse, ...args: any[]): ServerResponse {
    if (statusCode >= 200 && statusCode < 300) {
      recordRequest(backendName);
    } else {
      const body = (args[0] && typeof args[0] === 'string') ? args[0] : '';
      let message = `HTTP ${statusCode}`;
      try {
        const parsed = JSON.parse(body);
        if (parsed.error?.message) message = parsed.error.message;
      } catch { /* not JSON */ }
      recordFailure(backendName, message);
    }
    return originalEnd.call(this, ...args) as ServerResponse;
  };
}

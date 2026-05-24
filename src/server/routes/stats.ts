import { getSnapshot } from '../../stats/stats-store.js';
import { type IncomingMessage, type ServerResponse } from 'node:http';

export function handleStatsRoute(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const url = req.url ?? '';
  if (req.method !== 'GET' || url !== '/stats') return false;

  const snapshot = getSnapshot();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(snapshot));
  return true;
}

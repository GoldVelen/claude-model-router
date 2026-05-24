import { getSnapshot } from '../stats/stats-store.js';
import { type StatsSnapshot } from '../stats/stats-types.js';

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

export function printStats(): void {
  const snapshot: StatsSnapshot = getSnapshot();

  console.log('Proxy Statistics');
  console.log('─'.repeat(50));
  console.log(`Total requests: ${snapshot.total}`);
  console.log(`Uptime:         ${formatUptime(snapshot.uptime)}`);
  console.log(`Started:        ${snapshot.startTime}`);
  console.log('');

  const backends = Object.entries(snapshot.backends);
  if (backends.length === 0) {
    console.log('No requests recorded yet.');
    return;
  }

  console.log('Per-backend stats:');
  console.log(padEnd('  Backend', 20) + padEnd('Requests', 12) + 'Last Request');
  console.log('  ' + '─'.repeat(60));

  for (const [name, stats] of backends) {
    const count = String(stats.count);
    const last = stats.lastRequest ?? 'never';
    console.log('  ' + padEnd(name, 18) + padEnd(count, 12) + last);
  }
}

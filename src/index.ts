import { getConfig, reloadConfig, getConfigPath } from './config.js';
import { createServer } from './server.js';
import { startConfigWatcher } from './watcher.js';
import { ensureBackends } from './stats/stats-store.js';
import { checkForUpdate } from './utils/update-checker.js';
import { formatModelRouteLine } from './startup-summary.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = getConfig();
ensureBackends(Object.keys(config.backends));
const server = createServer();

// Background update check — non-blocking
const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf-8')) as { version: string };
checkForUpdate(pkg.version).then((result) => {
  if (result.updateAvailable) {
    console.log('');
    console.log(`\x1b[33m  Update available: ${result.current} → ${result.latest}\x1b[0m`);
    console.log(`\x1b[33m  Run: npm install -g claude-model-router\x1b[0m`);
    console.log('');
  }
});

server.listen(config.port, () => {
  console.log(`claude-model-router ready on :${config.port}`);
  console.log('');
  console.log('  Aliases:');
  for (const [alias, model] of Object.entries(config.aliases)) {
    console.log(formatModelRouteLine(alias, model, config));
  }
  if (config.routingTags && Object.keys(config.routingTags).length > 0) {
    console.log('');
    console.log('  Prompt routing tags:');
    for (const [tag, model] of Object.entries(config.routingTags)) {
      console.log(formatModelRouteLine(tag, model, config, 'openai-responses'));
    }
  }
  console.log('');
  console.log(`  Set ANTHROPIC_BASE_URL=http://127.0.0.1:${config.port} in Claude Code settings`);
});

const watcher = startConfigWatcher(getConfigPath(), reloadConfig);

process.on('SIGTERM', () => {
  console.log('[shutdown] closing watcher and server...');
  watcher.close();
  server.close();
});

process.on('SIGINT', () => {
  console.log('[shutdown] closing watcher and server...');
  watcher.close();
  server.close();
  process.exit(0);
});

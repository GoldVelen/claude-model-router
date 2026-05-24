import { getConfig, reloadConfig, getConfigPath } from './config.js';
import { createServer } from './server.js';
import { startConfigWatcher } from './watcher.js';

const config = getConfig();
const server = createServer();

server.listen(config.port, () => {
  const deepseekBackend = Object.values(config.backends).find((b) => b.modelPattern?.includes('deepseek'));
  const deepseekHost = deepseekBackend ? new URL(deepseekBackend.url).hostname : 'unknown';
  const claudeBackend = Object.values(config.backends).find((b) => b.modelPattern?.includes('claude'));
  const claudeHost = claudeBackend ? new URL(claudeBackend.url).hostname : 'unknown';

  console.log(`claude-model-router ready on :${config.port}`);
  console.log('');
  console.log('  Aliases:');
  for (const [alias, model] of Object.entries(config.aliases)) {
    const hostname = model.startsWith('claude-') ? claudeHost : deepseekHost;
    console.log(`    ${alias.padEnd(8)} → ${model.padEnd(24)} → ${hostname}`);
  }
  console.log('');
  console.log('  Set ANTHROPIC_BASE_URL=http://127.0.0.1:3457 in Claude Code settings');
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

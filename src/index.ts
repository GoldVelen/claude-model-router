import { loadConfig } from './config.js';
import { createServer } from './server.js';

const config = loadConfig();
const server = createServer(config);

server.listen(config.port, () => {
  console.log(`claude-model-router ready on :${config.port}`);
  console.log('');
  console.log('  Aliases:');
  for (const [alias, model] of Object.entries(config.aliases)) {
    const route = model.startsWith('claude-') ? 'api.anthropic.com' : 'api.deepseek.com';
    console.log(`    ${alias.padEnd(8)} → ${model.padEnd(24)} → ${route}`);
  }
  console.log('');
  console.log('  Set ANTHROPIC_BASE_URL=http://127.0.0.1:3457 in Claude Code settings');
});

import { type Config } from './types.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CONFIG_DIR = join(homedir(), '.config', 'claude-model-router');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
const DATA_DIR = join(homedir(), '.local', 'share', 'claude-model-router');

const DEFAULT_ALIASES: Record<string, string> = {
  dsp: 'deepseek-v4-pro',
  dsf: 'deepseek-v4-flash',
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
};

function createDefaultConfig(): Config {
  return {
    port: 3457,
    logLevel: 'info',
    backends: {
      deepseek: { url: 'https://api.deepseek.com', apiKey: '' },
      claude: { url: 'https://socheap.ai', apiKey: '' },
    },
    aliases: { ...DEFAULT_ALIASES },
  };
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readOrCreateConfig(): Config {
  const defaults = createDefaultConfig();
  ensureDir(CONFIG_DIR);

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf-8');
    return defaults;
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function applyEnvOverrides(config: Config): Config {
  return {
    ...config,
    port: Number(process.env['CMR_PORT']) || config.port,
    logLevel: (process.env['CMR_LOG_LEVEL'] as Config['logLevel']) || config.logLevel,
    backends: {
      deepseek: {
        ...config.backends.deepseek,
        apiKey: process.env['CMR_DEEPSEEK_KEY'] || config.backends.deepseek.apiKey,
      },
      claude: {
        ...config.backends.claude,
        apiKey: process.env['CMR_CLAUDE_KEY'] || config.backends.claude.apiKey,
      },
    },
  };
}

export function loadConfig(): Config {
  const base = readOrCreateConfig();
  return applyEnvOverrides(base);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getDataDir(): string {
  ensureDir(DATA_DIR);
  return DATA_DIR;
}

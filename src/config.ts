import { type Config } from './types.js';
import { validateConfig } from './validator.js';
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
      deepseek: {
        url: 'https://api.deepseek.com',
        apiKey: '',
        path: '/anthropic/v1/messages',
        modelPattern: '^deepseek-',
        sanitizer: 'deepseek' as const,
      },
      claude: {
        url: 'https://api.anthropic.com',
        apiKey: '',
        path: '/v1/messages',
        modelPattern: '^claude-',
      },
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    if (parsed['backends'] && typeof parsed['backends'] === 'object') {
      parsed['backends'] = migrateBackends(parsed['backends'] as Record<string, Record<string, unknown>>);
    }

    const merged = { ...defaults, ...parsed } as unknown as Config;

    const errors = validateConfig(merged as unknown as Record<string, unknown>);
    if (errors.length > 0) {
      console.error('Config validation failed:');
      for (const err of errors) {
        console.error(`  - ${err.field}: ${err.message}`);
      }
      process.exit(1);
    }

    return merged;
  } catch {
    return defaults;
  }
}

function applyEnvOverrides(config: Config): Config {
  const backends = { ...config.backends };

  if (backends['deepseek'] && process.env['CMR_DEEPSEEK_KEY']) {
    backends['deepseek'] = { ...backends['deepseek'], apiKey: process.env['CMR_DEEPSEEK_KEY'] };
  }
  if (backends['claude'] && process.env['CMR_CLAUDE_KEY']) {
    backends['claude'] = { ...backends['claude'], apiKey: process.env['CMR_CLAUDE_KEY'] };
  }

  return {
    ...config,
    port: Number(process.env['CMR_PORT']) || config.port,
    logLevel: (process.env['CMR_LOG_LEVEL'] as Config['logLevel']) || config.logLevel,
    backends,
  };
}

function migrateBackends(backends: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  const migrated: Record<string, Record<string, unknown>> = {};
  for (const [name, backend] of Object.entries(backends)) {
    migrated[name] = { ...backend };
    if (name === 'deepseek' && !migrated[name].path) {
      migrated[name].path = '/anthropic/v1/messages';
      migrated[name].modelPattern = migrated[name].modelPattern || '^deepseek-';
      migrated[name].sanitizer = migrated[name].sanitizer || 'deepseek';
    }
    if (name === 'claude' && !migrated[name].path) {
      migrated[name].path = '/v1/messages';
      migrated[name].modelPattern = migrated[name].modelPattern || '^claude-';
    }
  }
  return migrated;
}

export function loadConfig(): Config {
  const base = readOrCreateConfig();
  return applyEnvOverrides(base);
}

let currentConfig: Config | null = null;

export function getConfig(): Config {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig;
}

export function reloadConfig(): void {
  try {
    const newConfig = loadConfig();
    currentConfig = newConfig;
    console.log('[config] reloaded successfully');
  } catch (err) {
    console.error('[config] reload failed, keeping current config:', (err as Error).message);
  }
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getDataDir(): string {
  ensureDir(DATA_DIR);
  return DATA_DIR;
}

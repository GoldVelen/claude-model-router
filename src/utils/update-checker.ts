import https from 'node:https';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DATA_DIR = join(homedir(), '.local', 'share', 'claude-model-router');
const CHECKED_PATH = join(DATA_DIR, '.last_update_check');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/claude-model-router/latest';

interface CheckResult {
  updateAvailable: boolean;
  current: string;
  latest: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function shouldCheck(): boolean {
  if (!existsSync(CHECKED_PATH)) return true;
  try {
    const ts = parseInt(readFileSync(CHECKED_PATH, 'utf-8').trim(), 10);
    return Date.now() - ts > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

function markChecked(): void {
  ensureDir(DATA_DIR);
  writeFileSync(CHECKED_PATH, String(Date.now()), 'utf-8');
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(REGISTRY_URL, { timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { version?: string };
          resolve(parsed.version ?? '');
        } catch {
          reject(new Error('Failed to parse registry response'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

export async function checkForUpdate(currentVersion: string): Promise<CheckResult> {
  if (!shouldCheck()) {
    return { updateAvailable: false, current: currentVersion, latest: currentVersion };
  }

  const result = await fetchLatestVersion()
    .then((latest) => {
      markChecked();
      return {
        updateAvailable: compareVersions(latest, currentVersion) > 0,
        current: currentVersion,
        latest,
      };
    })
    .catch(() => {
      return { updateAvailable: false, current: currentVersion, latest: currentVersion };
    });

  return result;
}

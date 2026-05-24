import { watch, type FSWatcher } from 'node:fs';

export function startConfigWatcher(
  configPath: string,
  onReload: () => void,
): FSWatcher {
  let debounceTimer: NodeJS.Timeout | null = null;
  const DEBOUNCE_MS = 100;

  let watcher: FSWatcher;
  try {
    watcher = watch(configPath, (_event) => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[config] detected change, reloading...`);
        onReload();
      }, DEBOUNCE_MS);
    });

    watcher.on('error', (err: Error & { code?: string }) => {
      if (err.code === 'ENOENT') return;
      console.error(`[config] watcher error:`, err.message);
    });
  } catch (err) {
    const code = (err as Error & { code?: string }).code;
    if (code === 'ENOENT') {
      console.warn(`[config] config file not found at ${configPath}, watcher disabled`);
    }
    watcher = {
      close() {},
      ref() { return this; },
      unref() { return this; },
    } as FSWatcher;
  }

  return watcher;
}

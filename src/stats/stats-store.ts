import { type BackendStats, type StatsSnapshot } from './stats-types.js';

interface StoreState {
  readonly backends: Record<string, BackendStats>;
  readonly total: number;
  readonly startTime: string;
}

const EMPTY_STATS: BackendStats = {
  count: 0,
  lastRequest: null,
  failures: 0,
  consecutiveFailures: 0,
  lastError: null,
  lastErrorTime: null,
};

let state: StoreState = {
  backends: {},
  total: 0,
  startTime: new Date().toISOString(),
};

export function recordRequest(backendName: string): void {
  const prev = state.backends[backendName] ?? EMPTY_STATS;
  const now = new Date().toISOString();
  state = {
    ...state,
    total: state.total + 1,
    backends: {
      ...state.backends,
      [backendName]: {
        count: prev.count + 1,
        lastRequest: now,
        failures: prev.failures,
        consecutiveFailures: 0,
        lastError: prev.lastError,
        lastErrorTime: prev.lastErrorTime,
      },
    },
  };
}

export function recordFailure(backendName: string, error: string): void {
  const prev = state.backends[backendName] ?? EMPTY_STATS;
  const now = new Date().toISOString();
  state = {
    ...state,
    total: state.total + 1,
    backends: {
      ...state.backends,
      [backendName]: {
        count: prev.count + 1,
        lastRequest: now,
        failures: prev.failures + 1,
        consecutiveFailures: prev.consecutiveFailures + 1,
        lastError: error.slice(0, 200),
        lastErrorTime: now,
      },
    },
  };
}

export function isDegraded(backendName: string): boolean {
  const backend = state.backends[backendName];
  return backend ? backend.consecutiveFailures >= 3 : false;
}

export function getSnapshot(): StatsSnapshot {
  return {
    backends: { ...state.backends },
    total: state.total,
    uptime: Date.now() - new Date(state.startTime).getTime(),
    startTime: state.startTime,
  };
}

export function resetStats(): void {
  state = {
    backends: {},
    total: 0,
    startTime: new Date().toISOString(),
  };
}

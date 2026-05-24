export interface BackendStats {
  readonly count: number;
  readonly lastRequest: string | null;
  readonly failures: number;
  readonly consecutiveFailures: number;
  readonly lastError: string | null;
  readonly lastErrorTime: string | null;
}

export interface StatsSnapshot {
  readonly backends: Readonly<Record<string, BackendStats>>;
  readonly total: number;
  readonly uptime: number;
  readonly startTime: string;
}

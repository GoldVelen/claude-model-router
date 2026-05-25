import type { PipelineContext } from '../pipeline.js';

export type StageStatus = 'pending' | 'running' | 'done' | 'failed' | 'timeout';
export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'aborted';

export interface StageRecord {
  name: string;
  status: StageStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface ManifestVerificationResult {
  expected: Array<{ path: string; operation: 'CREATE' | 'MODIFY' | 'DELETE' }>;
  actual: { written: string[]; unchanged: string[]; unexpected: string[] };
  missing: string[];
  unplanned: string[];
  matched: string[];
}

export interface JobRecord {
  jobId: string;
  task: string;
  workingDir?: string;
  autoCommit: boolean;
  status: JobStatus;
  currentStage: string | null;
  stages: StageRecord[];
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  ctx?: PipelineContext;
  report?: string;
  executeResult?: string;
  manifestVerification?: ManifestVerificationResult;
  errorMessage?: string;
}

const jobs = new Map<string, JobRecord>();
const MAX_JOBS = 100;

function evictOldest(): void {
  if (jobs.size <= MAX_JOBS) return;
  const sorted = Array.from(jobs.entries()).sort((a, b) => a[1].startedAt - b[1].startedAt);
  const toDelete = sorted.slice(0, jobs.size - MAX_JOBS);
  for (const [id] of toDelete) jobs.delete(id);
}

export function createJob(input: {
  task: string;
  workingDir?: string;
  autoCommit: boolean;
  stageNames: string[];
}): JobRecord {
  const jobId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: JobRecord = {
    jobId,
    task: input.task,
    workingDir: input.workingDir,
    autoCommit: input.autoCommit,
    status: 'pending',
    currentStage: null,
    stages: input.stageNames.map((name) => ({ name, status: 'pending' as StageStatus })),
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);
  evictOldest();
  return job;
}

export function getJob(jobId: string): JobRecord | undefined {
  return jobs.get(jobId);
}

export function listJobs(): JobRecord[] {
  return Array.from(jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
}

export function updateJob(jobId: string, patch: Partial<JobRecord>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.set(jobId, { ...job, ...patch });
}

export function updateStage(jobId: string, stageName: string, patch: Partial<StageRecord>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const newStages = job.stages.map((s) => (s.name === stageName ? { ...s, ...patch } : s));
  jobs.set(jobId, { ...job, stages: newStages });
}

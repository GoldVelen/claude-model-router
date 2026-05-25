import { type IncomingMessage, type ServerResponse } from 'node:http';
import { listJobs } from '../job-store.js';

export function handleApiRunsRoute(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET' && (req.url === '/api/runs' || req.url === '/api/runs/')) {
    const jobs = listJobs().map((j) => ({
      jobId: j.jobId,
      task: j.task.slice(0, 200),
      status: j.status,
      currentStage: j.currentStage,
      stages: j.stages.map((s) => ({ name: s.name, status: s.status, durationMs: s.durationMs })),
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      durationMs: j.durationMs,
      hasReport: !!j.report,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jobs }));
    return true;
  }
  return false;
}

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { getConfig } from '../../config.js';
import { getPipelineStages, runPipeline, type PipelineContext } from '../../pipeline.js';

interface PipelineResult {
  ctx: PipelineContext;
  stages: string[];
  failedStages: string[];
  timedOutStages: string[];
}

const jobs = new Map<string, { status: string; ctx?: PipelineContext }>();

export function handleApiRunRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/api/run/')) {
    const jobId = url.slice('/api/run/'.length);
    const job = jobs.get(jobId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Job not found' }));
      return true;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(job));
    return true;
  }

  if (req.method === 'POST' && url === '/api/run') {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', async () => {
      try {
        const { task, workingDir, autoCommit } = JSON.parse(body) as {
          task?: string;
          workingDir?: string;
          autoCommit?: boolean;
        };
        if (!task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task is required' }));
          return;
        }

        const config = getConfig();
        const port = config.port || 3457;
        const jobId = `run-${Date.now()}`;
        jobs.set(jobId, { status: 'running' });

        const result: PipelineResult = await runPipeline(task, config, port, {
          workingDir,
          autoCommit: autoCommit ?? false,
        });
        jobs.set(jobId, { status: 'done', ctx: result.ctx });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return true;
  }

  return false;
}

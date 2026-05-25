import { type IncomingMessage, type ServerResponse } from 'node:http';
import { getConfig } from '../../config.js';
import { getPipelineStages, runPipeline, type PipelineContext } from '../../pipeline.js';
import { createJob, getJob, updateJob, updateStage } from '../job-store.js';

export function handleApiRunRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';

  if (req.method === 'GET' && url.startsWith('/api/run/') && url !== '/api/run/') {
    const jobId = url.slice('/api/run/'.length);
    const job = getJob(jobId);
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
    req.on('end', () => {
      try {
        const { task, workingDir, autoCommit, language } = JSON.parse(body) as {
          task?: string;
          workingDir?: string;
          autoCommit?: boolean;
          language?: 'en' | 'zh';
        };
        if (!task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task is required' }));
          return;
        }

        const config = getConfig();
        const port = config.port || 3457;
        const stageNames = Object.keys(getPipelineStages(config));
        const job = createJob({ task, workingDir, autoCommit: autoCommit ?? false, stageNames });

        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jobId: job.jobId }));

        runPipelineInBackground(job.jobId, task, config, port, workingDir, autoCommit ?? false, language ?? 'en');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return true;
  }

  return false;
}

function runPipelineInBackground(
  jobId: string,
  task: string,
  config: ReturnType<typeof getConfig>,
  port: number,
  workingDir: string | undefined,
  autoCommit: boolean,
  language: 'en' | 'zh',
): void {
  updateJob(jobId, { status: 'running' });

  runPipeline(task, config, port, {
    workingDir,
    autoCommit,
    language,
    callbacks: {
      onStageStart: (name) => {
        updateJob(jobId, { currentStage: name });
        updateStage(jobId, name, { status: 'running', startedAt: Date.now() });
      },
      onStageEnd: (name, result) => {
        updateStage(jobId, name, {
          status: result.status,
          finishedAt: Date.now(),
          durationMs: result.durationMs,
          error: result.error,
        });
      },
      onExecutePhaseEnd: (ctx) => {
        updateJob(jobId, {
          executeResult: ctx.executeResult,
          report: ctx.report,
        });
      },
    },
  })
    .then((result) => {
      const failed = result.failedStages.length > 0 || result.timedOutStages.length > 0;
      updateJob(jobId, {
        status: failed ? 'failed' : 'done',
        currentStage: null,
        finishedAt: Date.now(),
        durationMs: Date.now() - (getJob(jobId)?.startedAt ?? Date.now()),
        ctx: result.ctx,
        report: result.ctx.report,
        executeResult: result.ctx.executeResult,
      });
    })
    .catch((err: unknown) => {
      const errorMessage = err instanceof Error ? err.message : String(err);
      updateJob(jobId, {
        status: 'failed',
        currentStage: null,
        finishedAt: Date.now(),
        errorMessage,
      });
    });
}

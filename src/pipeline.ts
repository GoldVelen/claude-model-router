import { type Config } from './types.js';
import { resolveModel } from './router.js';
import http from 'node:http';

const DEFAULT_PIPELINE_STAGES: Record<string, { model: string; prompt: string }> = {
  plan: {
    model: 'opus',
    prompt: `You are a software architect. Create a detailed implementation plan for the following task. Include architecture decisions, file structure, and step-by-step approach. Be specific and actionable.

Task: {task}`,
  },
  implement: {
    model: 'dsp',
    prompt: `You are a senior developer. Implement the task according to the plan below. Write complete, production-ready, well-tested code. Follow the plan's architecture and file structure.

Task: {task}

Plan:
{plan}`,
  },
  test: {
    model: 'sonnet',
    prompt: `You are a QA engineer. Review the implementation below and write comprehensive tests. Cover happy paths, edge cases, error handling, and integration points. Identify any gaps or bugs.

Plan:
{plan}

Implementation:
{implement}`,
  },
  report: {
    model: 'dsf',
    prompt: `You are a technical writer. Create a concise summary report of the work done below. Format as markdown. Include: what was accomplished, key decisions, file changes, test coverage, and any issues found.

Plan:
{plan}

Implementation:
{implement}

Test Results:
{test}`,
  },
};

export function getPipelineStages(config: Config): Record<string, { model: string; prompt: string }> {
  if (config.pipeline) {
    const merged: Record<string, { model: string; prompt: string }> = {};
    for (const [stage, defaults] of Object.entries(DEFAULT_PIPELINE_STAGES)) {
      merged[stage] = config.pipeline[stage] ?? defaults;
    }
    for (const [stage, cfg] of Object.entries(config.pipeline)) {
      if (!merged[stage]) {
        merged[stage] = cfg;
      }
    }
    return merged;
  }
  return { ...DEFAULT_PIPELINE_STAGES };
}

export function resolveStageModel(
  stageModel: string,
  config: Config,
): string {
  return resolveModel(stageModel, config.aliases);
}

export interface PipelineContext {
  task: string;
  [stage: string]: string;
}

export function interpolatePrompt(template: string, ctx: PipelineContext): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => ctx[key] ?? `{${key}}`);
}

export interface CallModelOptions {
  port: number;
  timeout?: number;
}

export function callModel(
  model: string,
  prompt: string,
  opts: CallModelOptions,
): Promise<string> {
  const body = JSON.stringify({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: opts.port,
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body)),
        },
        timeout: opts.timeout ?? 300_000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk.toString()));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(new Error(`API returned ${res.statusCode}: ${data.slice(0, 500)}`));
            return;
          }
          try {
            const parsed = JSON.parse(data) as {
              content?: Array<{ type: string; text?: string }>;
            };
            const text = parsed.content
              ?.filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n') ?? data;
            resolve(text || data);
          } catch {
            resolve(data);
          }
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timed out after ${opts.timeout ?? 300_000}ms`));
    });

    req.on('error', (err) => {
      reject(new Error(`Cannot reach proxy at 127.0.0.1:${opts.port} — is cmr running? (${err.message})`));
    });

    req.write(body);
    req.end();
  });
}

export async function runPipeline(
  task: string,
  config: Config,
  port: number,
): Promise<{ ctx: PipelineContext; stages: string[] }> {
  const stages = getPipelineStages(config);
  const stageNames = Object.keys(stages);
  const ctx: PipelineContext = { task };

  for (const name of stageNames) {
    const stage = stages[name]!;
    const model = resolveStageModel(stage.model, config);
    const prompt = interpolatePrompt(stage.prompt, ctx);

    process.stderr.write(`\n[${name}] running with model ${model}...\n`);

    const result = await callModel(model, prompt, { port });
    ctx[name] = result;
  }

  return { ctx, stages: stageNames };
}

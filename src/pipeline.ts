import { type Config } from './types.js';
import { resolveModel } from './router.js';
import http from 'node:http';

const DEFAULT_PIPELINE_STAGES: Record<string, { model: string; prompt: string }> = {
  plan: {
    model: 'opus',
    prompt: `You are the architect. Your output is the BLUEPRINT — the implementer will follow it EXACTLY with no independent decisions.

Produce a prescriptive implementation guide for the task below. This must be complete enough that a senior developer can execute it line-by-line without ambiguity. Include:

1. Architecture Decision — what pattern / structure, and WHY (one paragraph)
2. File Manifest — every file to create or modify, with its full path and one-line purpose
3. For each file:
   - Exact interfaces, types, function signatures (names, params, return types)
   - Key implementation logic described precisely (not pseudocode — specify the exact approach)
   - Imports: list what each file imports from where
   - Constraints: any rules the implementer must follow (no deps, no mutation, etc.)
4. Implementation Order — numbered steps, each step listing which file(s) to work on
5. Test Specification — what to test, how to test, edge cases to cover
6. Acceptance Checklist — concrete conditions that must be true when done

CRITICAL RULES your plan must enforce:
- Zero runtime dependencies (Node.js built-ins only)
- TypeScript strict mode
- Immutable patterns: create new objects, never mutate
- Early returns over deep nesting
- Files under 800 lines, functions under 50 lines
- 80%+ test coverage
- No comments unless the WHY is non-obvious

Task: {task}

## File Manifest（强制要求 — 机器解析）

最后必须输出一个由 <!-- MANIFEST_START --> 和 <!-- MANIFEST_END --> 包围的 JSON 清单。格式：

<!-- MANIFEST_START -->
\`\`\`json
{
  "files": [
    { "path": "src/foo.ts", "operation": "CREATE", "purpose": "新增 X 模块" },
    { "path": "src/bar.ts", "operation": "MODIFY", "purpose": "增加 Y 函数；修改 Z handler" },
    { "path": "src/old.ts", "operation": "DELETE", "purpose": "已被 foo.ts 取代" }
  ]
}
\`\`\`
operation 字段只能是 CREATE / MODIFY / DELETE 之一。path 必须是相对项目根的路径。这是后续验证步骤的输入，不要省略或改格式。`,
  },
  implement: {
    model: 'dsp',
    prompt: `You are the implementer. You execute the plan EXACTLY as written — you do NOT design, improve, or deviate.

RULES (absolute):
- Follow the plan's file structure, function signatures, and implementation approach precisely
- If something in the plan is ambiguous or contradictory, FLAG IT as a [DEVIATION] — do not guess
- Do NOT add features, abstractions, or error handling beyond what the plan specifies
- Do NOT refactor or "improve" existing code unless the plan explicitly tells you to
- Use the exact names, types, and patterns from the plan
- If a constraint is listed (zero deps, immutable, etc.), enforce it

	Your output must be the actual code changes:
	- For every file, output the COMPLETE file content (not diffs, not patches)
	- Use code block with language:filepath format, e.g. typescript:src/file.ts
	- Never output diff/patch format (no ---/+++ headers, no @@ hunks)
	- NEVER write partial diffs

Task: {task}

Plan:
{plan}`,
  },
  test: {
    model: 'sonnet',
    prompt: `You are the tester. Your job: verify the implementation matches the plan EXACTLY and works correctly.

Checklist:
1. PLAN COMPLIANCE — does every file, function, and type match what the plan specified? Flag any deviation.
2. CORRECTNESS — do the tests pass? Does the logic work?
3. COVERAGE — is test coverage >= 80%? If not, write the missing tests.
4. EDGE CASES — test empty inputs, boundary values, error paths, concurrent access
5. CONSTRAINTS — are all plan constraints met? (zero deps, immutable patterns, no deep nesting, etc.)

Output test files with complete test cases. Use the project's existing test patterns (node:test, describe/it, assert). Each test must have a descriptive name explaining what behavior it verifies.

If you find bugs or deviations, write FAILING tests that demonstrate the issue — the implementer will fix them.

Plan:
{plan}

Implementation:
{implement}`,
  },
  execute: {
    model: 'dsf',
    prompt: `You are the code executor. Extract all code blocks from the implementation and format them for file writing.

RULES:
- Find all code blocks in the implementation text
- For each code block, identify the file path
- Output in this exact format:

\`\`\`typescript:src/example.ts
// code here
\`\`\`

Or use:

File: src/example.ts
\`\`\`typescript
// code here
\`\`\`

Implementation to parse:
{implement}`,
  },
  report: {
    model: 'dsf',
    prompt: `You are the reporter. Create a concise summary in markdown. Focus on WHAT changed and whether the implementation matches the plan.

{languageInstruction}

Structure:
## Summary
- 2-3 sentences on what was accomplished

## Plan vs Implementation
- Table: each file from the plan, whether it was created/modified, any deviations

## File Changes
- Table: file path | operation (create/modify) | purpose

## Test Results
- Test count, suites, coverage estimate, any failures

## Manifest Compliance
- Reference Manifest Verification content, clearly indicate which planned files were not actually modified

## Issues & Follow-ups
- Any [DEVIATION] flags from the implementer
- Any failing tests from the tester
- Recommended next steps

Keep it tight. No fluff.

Plan:
{plan}

Implementation:
{implement}

Test Results:
{test}

Manifest Verification:
{manifestReport}`,
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

export interface PipelineProgressCallbacks {
  onStageStart?: (name: string, index: number, total: number) => void;
  onStageEnd?: (name: string, result: { status: 'done' | 'failed' | 'timeout'; durationMs: number; error?: string }) => void;
  onExecutePhaseStart?: () => void;
  onExecutePhaseEnd?: (ctx: PipelineContext) => void;
}

export interface PipelineResult {
  ctx: PipelineContext;
  stages: string[];
  failedStages: string[];
  timedOutStages: string[];
  abortedAt: string | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export async function runPipeline(
  task: string,
  config: Config,
  port: number,
  options?: {
    timeoutPerStage?: number;
    signal?: AbortSignal;
    workingDir?: string;
    autoCommit?: boolean;
    callbacks?: PipelineProgressCallbacks;
    language?: 'en' | 'zh';
  },
): Promise<PipelineResult> {
  const stages = getPipelineStages(config);
  const stageNames = Object.keys(stages);
  const total = stageNames.length;
  const ctx: PipelineContext = { task };
  const failedStages: string[] = [];
  const timedOutStages: string[] = [];
  const defaultTimeout = options?.timeoutPerStage ?? 300_000;

  for (let i = 0; i < stageNames.length; i++) {
    if (options?.signal?.aborted) {
      return { ctx, stages: stageNames, failedStages, timedOutStages, abortedAt: stageNames[i] ?? null };
    }
    const name = stageNames[i]!;
    const stage = stages[name]!;
    const model = resolveStageModel(stage.model, config);

    let promptTemplate = stage.prompt;
    if (name === 'report' && options?.language) {
      const languageInstruction = options.language === 'zh'
        ? 'IMPORTANT: Output the entire report in Chinese (中文). All section headers, descriptions, and content must be in Chinese.'
        : 'IMPORTANT: Output the entire report in English. All section headers, descriptions, and content must be in English.';
      promptTemplate = promptTemplate.replace('{languageInstruction}', languageInstruction);
    } else {
      promptTemplate = promptTemplate.replace('{languageInstruction}', '');
    }

    const prompt = interpolatePrompt(promptTemplate, ctx);
    const num = i + 1;
    const stageTimeout = defaultTimeout;

    process.stderr.write(`[${num}/${total}] ${name} (${model}) running...\n`);
    options?.callbacks?.onStageStart?.(name, num, total);

    const startTime = Date.now();

    try {
      const result = await Promise.race([
        callModel(model, prompt, { port, timeout: stageTimeout }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), stageTimeout)
        ),
      ]);

      const duration = Date.now() - startTime;
      process.stderr.write(`[${num}/${total}] ${name} completed in ${formatDuration(duration)}\n`);
      ctx[name] = result;
      options?.callbacks?.onStageEnd?.(name, { status: 'done', durationMs: duration });
    } catch (err) {
      const duration = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      if (message.includes('timeout')) {
        process.stderr.write(`[${num}/${total}] ${name} timeout after ${formatDuration(duration)}\n`);
        timedOutStages.push(name);
        ctx[name] = '[TIMEOUT]';
        options?.callbacks?.onStageEnd?.(name, { status: 'timeout', durationMs: duration, error: message });
      } else {
        process.stderr.write(`[${num}/${total}] ${name} failed: ${message}\n`);
        failedStages.push(name);
        ctx[name] = `[ERROR: ${message}]`;
        options?.callbacks?.onStageEnd?.(name, { status: 'failed', durationMs: duration, error: message });
      }
    }
  }

  const implementSource = (ctx.execute && !ctx.execute.startsWith('[')) ? ctx.execute : ctx.implement;

  if (options?.workingDir && implementSource && !implementSource.startsWith('[')) {
    options?.callbacks?.onExecutePhaseStart?.();
    try {
      const { executeCodeChanges, runTests, gitCommit } = await import('./executor.js');

      const executeResult = await executeCodeChanges(implementSource, {
        workingDir: options.workingDir,
        dryRun: false,
      });

      ctx.executeResult = JSON.stringify(executeResult, null, 2);

      if (executeResult.filesWritten.length > 0) {
        process.stderr.write(`[execute] Wrote ${executeResult.filesWritten.length} files (source: ${ctx.execute ? 'execute' : 'implement'})\n`);

        const testResult = await runTests(options.workingDir);
        ctx.testExecution = testResult.output;

        if (testResult.success) {
          process.stderr.write('[execute] Tests passed\n');

          if (options.autoCommit) {
            const commitMsg = `feat: ${task}\n\nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`;
            const commitResult = await gitCommit(options.workingDir, commitMsg);
            ctx.gitCommit = commitResult.output;

            if (commitResult.success) {
              process.stderr.write('[execute] Changes committed\n');
            } else {
              process.stderr.write(`[execute] Commit failed: ${commitResult.output}\n`);
            }
          }
        } else {
          process.stderr.write(`[execute] Tests failed:\n${testResult.output}\n`);
        }
      }

      if (executeResult.errors.length > 0) {
        process.stderr.write(`[execute] Errors: ${executeResult.errors.join(', ')}\n`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[execute] Failed: ${message}\n`);
      ctx.executeError = message;
    } finally {
      options?.callbacks?.onExecutePhaseEnd?.(ctx);
    }
  }

  if (options?.workingDir && ctx.plan && !ctx.plan.startsWith('[')) {
    try {
      const { parseManifest, verifyManifest, formatVerificationReport } = await import('./manifest.js');
      const manifest = parseManifest(ctx.plan);
      if (manifest) {
        const executeResult = ctx.executeResult ? (JSON.parse(ctx.executeResult) as { filesWritten?: string[] }) : null;
        const written = executeResult?.filesWritten ?? [];
        const verification = await verifyManifest(manifest, options.workingDir, written);
        ctx.manifestVerification = JSON.stringify(verification);
        ctx.manifestReport = formatVerificationReport(verification);
        process.stderr.write(`[verify] ${verification.matched.length} matched, ${verification.missing.length} missing, ${verification.unplanned.length} unplanned\n`);
      } else {
        ctx.manifestReport = '[Manifest] Plan did not include a parseable manifest block';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.manifestReport = `[Manifest] Verification failed: ${message}`;
    }
  }

  if (ctx.report && !ctx.report.startsWith('[')) {
    process.stderr.write('\n========== PIPELINE REPORT ==========\n');
    process.stderr.write(ctx.report + '\n');
    if (ctx.manifestReport) {
      process.stderr.write('\n' + ctx.manifestReport + '\n');
    }
    process.stderr.write('=====================================\n\n');
  }

  return { ctx, stages: stageNames, failedStages, timedOutStages, abortedAt: null };
}

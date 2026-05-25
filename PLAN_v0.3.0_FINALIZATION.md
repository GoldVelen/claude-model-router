# v0.3.0 完工实施计划

> **目标**：完成 v0.3.0 收尾 — 验证遗漏功能、同步文档(含GitHub可见)、补强缺陷。
> **执行者**：deepseek（按本计划逐节执行，每节独立提交，不自行扩大范围）。
> **日期**：2026-05-25

---

## 0. 执行规则

1. **不扩大范围**：只做本计划列出的事项，不重构不引入新依赖。
2. **每节独立提交**：完成 → `npm run lint && npm test` → commit → 下一节。某节失败停下报告，不进下一节。
3. **保持约束**：零运行时依赖、TS strict、不可变模式、文件 < 800 行、函数 < 50 行。
4. **测试**：新代码 ≥ 80% 覆盖；改动不能退化现有的 75 个测试。
5. **commit 格式**：`<type>: <description>`，type ∈ {feat, fix, docs, test, refactor, chore}。
6. **遇到歧义**：立即标 `[BLOCKER]` 暂停，不要猜。

---

## 1. 任务总览

| #    | 章节                 | 类型 | 优先级 | 估时 |
|------|----------------------|------|--------|------|
| A    | TUI dashboard 验证+修复 | 验证 | **P0** | 0.5h |
| B    | Auto fallback 验证+测试 | 验证 | **P0** | 1.5h |
| C    | Pipeline checkpoint 修复+验证 | 修复 | **P0** | 2h   |
| D    | GitHub 文档同步       | 文档 | **P0** | 1h   |
| E    | Web UI 基础认证       | 改进 | P1     | 2h   |
| F    | Stats 持久化          | 改进 | P2     | 1h   |
| G    | Degraded 健康探活     | 改进 | P2     | 1h   |
| H    | Pipeline 超时可配置   | 改进 | P2     | 0.5h |
| I    | API key 脱敏审计统一  | 审计 | P1     | 1h   |
| J    | 端到端集成测试        | 测试 | P1     | 2h   |
| K    | Tag-based changelog   | 文档 | P2     | 0.3h |
| L    | Windows TUI 兼容      | 兼容 | P2     | 0.5h |

---

## 2. 章节 A — TUI Dashboard 验证

### 2.1 修复（代码级，先做）

**P-A1** — `bin/cmr.js` line 585 有 `'r' to refresh` 提示但代码未处理 'r'：

```diff
-    process.stdout.write(`Press 'q' to quit, 'r' to refresh  │ Refresh: ${new Date().toLocaleTimeString()}\n`);
+    process.stdout.write(`Press 'q' to quit  │  Refresh: ${new Date().toLocaleTimeString()}\n`);
```

**P-A2** — 非 TTY 终端下 `setRawMode` 会抛异常。在 `cmdDashboard()` 开头加：

```js
if (!process.stdin.isTTY) {
  console.log('Dashboard requires an interactive terminal (TTY).');
  process.exit(1);
}
```

**P-A3** — `reset` 颜色常量未定义。检查 bin/cmr.js line 493-495 已定义了 red/green/yellow/reset，但 line 565 使用了 `reset`。确认已有。（快速浏览 lines 491-496）

### 2.2 手动验证步骤

1. `cmr start`
2. 发一条请求触发 stats：
   ```bash
   curl -s -X POST http://127.0.0.1:3457/v1/messages \
     -H "Content-Type: application/json" \
     -d '{"model":"claude-haiku-4-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
   ```
3. `cmr dashboard`
4. 确认：Header 显示 Status/Uptime、Backend 表格正确、日志区有内容、右下角时间每秒刷新、`q` 退出光标恢复

### 提交
```
fix: dashboard non-TTY guard and remove unimplemented hotkey hint
```

---

## 3. 章节 B — Auto Fallback 验证

### 3.1 新增测试文件：`tests/integration-fallback.test.ts`

用 `http.createServer` 起两个假后端（一个故意 500，一个 200），注入到 router 的 selectBackends，发 4 次代理请求验证逐条行为。

**测试用例**：
| # | 场景 | 断言 |
|---|------|------|
| 1 | 正常请求，所有 backend OK | 200，stats 计数 +1，consecutiveFailures = 0 |
| 2 | 主 backend 500，fallback 200 | 客户端拿 200，主 backend failures=1 |
| 3 | 连续 3 次失败 | consecutiveFailures = 3，isDegraded = true |
| 4 | degraded 后被过滤 | 第 4 次请求不经过 degraded backend（走另一个） |
| 5 | 1 次成功后 consecutiveFailures 归零 | recordRequest 清零逻辑 |
| 6 | 全部 backend degraded | 502 + "All backends exhausted" |

### 3.2 修复：recordFailure 让 total 重复计数

看 `stats-store.ts`：`recordFailure` 也递增 total。这意味着一次失败请求 total 会加两次（recordRequest + recordFailure）。

**但**：实际上 `recordFailure` 的调用路径是：
- `stats-middleware.ts` line 31: 2xx → recordRequest；非 2xx → recordFailure
- 两者是互斥的，不会重复计数。

所以这里 **没问题**，不需要修。测试验证这个互斥行为即可。

### 提交
```
test: add auto fallback integration tests
```

---

## 4. 章节 C — Pipeline Checkpoint 修复

### 4.1 问题

当前 `cmdRun` 中的 SIGINT 处理逻辑有 bug：`runPipeline` 内部没有 abort 机制，SIGINT 会等到所有 stage 跑完才返回。用户 Ctrl+C 实际上没中断到正在跑的 stage。

### 4.2 修复方案

**修改 `src/pipeline.ts`**：

```typescript
// PipelineResult 新增字段
export interface PipelineResult {
  ctx: PipelineContext;
  stages: string[];
  failedStages: string[];
  timedOutStages: string[];
  abortedAt: string | null;  // ← 新增
}

// runPipeline 新增 signal 参数
export async function runPipeline(
  task: string,
  config: Config,
  port: number,
  options?: { timeoutPerStage?: number; signal?: AbortSignal },
): Promise<PipelineResult> {
  // ... 现有代码 ...
  for (let i = 0; i < stageNames.length; i++) {
    // ← 新增：每阶段前检查
    if (options?.signal?.aborted) {
      // 将 abortedAt 设为上一个 stage 之后的位置（实际是当前 stage 被打断）
      return {
        ctx, stages: stageNames,
        failedStages, timedOutStages,
        abortedAt: stageNames[i],
      };
    }
    // ... 现有 stage 执行逻辑保持不变 ...
  }
  return { ctx, stages: stageNames, failedStages, timedOutStages, abortedAt: null };
}
```

**修改 `bin/cmr.js` 的 `cmdRun`**：

```js
// 用 AbortController 替代 interrupt 布尔变量
const controller = new AbortController();
const onSigint = () => {
  process.stderr.write('\n[INTERRUPTED] Saving checkpoint...\n');
  controller.abort();
};
process.on('SIGINT', onSigint);

let result;
try {
  result = await runPipeline(task, config, port, { signal: controller.signal });
} catch (err) {
  process.removeListener('SIGINT', onSigint);
  // ... 现有 error 处理 ...
}

process.removeListener('SIGINT', onSigint);

// 替代原来的 if (interrupted && result)
if (result?.abortedAt) {
  const currentIdx = result.stages.indexOf(result.abortedAt);
  // ... 现有 checkpoint 写入逻辑（保持不变）...
  // 但 currentIdx 计算改为 result.stages.indexOf(result.abortedAt)
}
```

### 4.3 测试：`tests/pipeline-abort.test.ts`

- 起一个延迟响应（等 500ms）的 mock proxy
- `setTimeout(() => controller.abort(), 100)` 在 stage 执行期间 abort
- assert `result.abortedAt` 等于当前 stage 名
- assert ctx 已有已完成 stage 的输出

### 4.4 手动验证
1. `cmr run` → 输入 task → stage 1 跑起后立即 Ctrl+C
2. 看到 checkpoint saved 提示
3. `cmr run resume <id>` → 从中断阶段继续

### 提交（拆两个）
```
fix: pipeline SIGINT now aborts mid-stage via AbortSignal
test: add pipeline abort test
```

---

## 5. 章节 D — GitHub 文档同步（最关键）

### 5.1 当前状态

- package.json version = `0.3.0` ✓
- README.md 本地已含 v0.3.0 章节 ✓
- CHANGELOG.md 落后：标题还是 `## Unreleased`，缺 v0.3.0 条目 ✗

### 5.2 CHANGELOG.md 重写

将现有 `## Unreleased` 重命名为 `## v0.3.0`，原有 Unreleased 内容移到 `## v0.2.0`。新增条目：

```markdown
# Changelog

## v0.3.0

### Features
- auto fallback with degraded backend tracking
- TUI dashboard (real-time health, stats, logs)
- Web management UI at /web
- stats/health monitoring (cmr stats, cmr health)
- pipeline progress output, per-stage timeout, Ctrl+C checkpoint/resume
- multi-input pipeline (interactive, --file, --stdin, args)
- setup guard (prompts cmr setup if config missing)

### Bug Fixes
- public/index.html path resolution in web route (d555c96)
- dashboard non-TTY guard
- pipeline SIGINT now aborts mid-stage

### Documentation
- README v0.3.0 features section
- architecture diagram in README
- bilingual updates (EN/CN)

## v0.2.0

### Features
- pipeline engine for auto model dispatch
- multi-backend routing with modelPattern
- config validation and hot reload
- CLI daemon, setup and pipeline commands

### Bug Fixes
- empty PID file falsely detected as running
- strict plan-to-implementation pipeline discipline

### Documentation
- bilingual README (EN/CN)

## v0.1.0

- initial release
```

### 5.3 README 修补

**D3-a**：Quick Start 区后面加 Web UI 提示：
```markdown
After starting, visit `http://127.0.0.1:3457/web` for the web management UI.
```

**D3-b**：line 223 "v0.2.0 is fully backward-compatible" → "v0.3.0 is fully backward-compatible with v0.1.x and v0.2.x configs."

**D3-c**：TUI dashboard 节补充终端要求：
```markdown
**`cmr dashboard`** ... Requires an interactive terminal at least 80 columns wide.
```

**D3-d**：Web UI 节补充安全提示：
```markdown
> Security note: Web UI binds to localhost only. Do not expose port 3457 to public networks.
```

**D3-e**：新增 Architecture 章节（line 232 之前）。内容即当前 README 的 ASCII 图更新版，加上目录树：
```
src/
├── server.ts       HTTP server + retry loop + fallback
├── router.ts       Backend selection (modelPattern + degraded)
├── pipeline.ts     Multi-stage orchestration
├── config.ts       Config load + hot reload + env override
├── watcher.ts      fs.watch on config.json
├── validator.ts    Config schema validation
├── sanitize.ts     DeepSeek request sanitizer
├── stats/          Per-backend metrics (immutable)
├── server/routes/  HTTP routes (stats, web, api-config, api-run, api-logs)
├── commands/       CLI-only logic (stats, health)
└── utils/          http-client, changelog-generator
```

### 5.4 验证
```bash
git add CHANGELOG.md README.md
git commit -m "docs: sync README and CHANGELOG for v0.3.0"
git push origin main
```
打开 https://github.com/GoldVelen/claude-model-router 确认 README 和 CHANGELOG 渲染正确。

### 提交
```
docs: sync README and CHANGELOG for v0.3.0
```

---

## 6. 章节 E — Web UI 基础认证

### 6.1 新增文件 `src/server/middleware/auth.ts`

```typescript
import { type IncomingMessage, type ServerResponse } from 'node:http';

const PROTECTED = ['/web', '/api/'];

export function getAuthToken(): string | null {
  return process.env['CMR_WEB_AUTH_TOKEN'] || null;
}

export function isPathProtected(url: string): boolean {
  return PROTECTED.some(p => url === p || url.startsWith(p));
}

function extractToken(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string') {
    const m = cookie.match(/(?:^|;\s*)cmr_token=([^;]+)/);
    if (m) return decodeURIComponent(m[1] ?? '');
  }
  return null;
}

export function checkAuth(req: IncomingMessage, res: ServerResponse): boolean {
  const required = getAuthToken();
  if (!required) return true;
  const url = req.url ?? '';
  if (!isPathProtected(url)) return true;
  if (url === '/web/login') return true;
  if (extractToken(req) === required) return true;

  const accept = req.headers['accept'] ?? '';
  // 浏览器请求 → 302 到 login；否则 → 401
  res.writeHead(
    typeof accept === 'string' && accept.includes('text/html') ? 302 : 401,
    typeof accept === 'string' && accept.includes('text/html')
      ? { Location: '/web/login' }
      : { 'Content-Type': 'application/json' },
  );
  if (!(typeof accept === 'string' && accept.includes('text/html'))) {
    res.end(JSON.stringify({ error: 'Unauthorized' }));
  } else {
    res.end();
  }
  return false;
}
```

### 6.2 新增文件 `src/server/routes/login.ts`

```typescript
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { getAuthToken } from '../middleware/auth.js';

const LOGIN_HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CMR Login</title>
<style>body{font-family:monospace;background:#111;color:#e0e0e0;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
.card{background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:32px;width:360px}
input{width:100%;background:#0a0a0a;color:#e0e0e0;border:1px solid #333;border-radius:4px;padding:8px;font-size:14px;margin:8px 0}
button{width:100%;background:#2563eb;color:#fff;border:none;border-radius:4px;padding:8px 16px;cursor:pointer;font-size:14px;margin-top:12px}
.error{color:#f00;font-size:13px;margin-top:8px}</style></head>
<body><div class="card"><h2>CMR Login</h2>
<form method="POST" action="/web/login">
<input name="token" type="password" placeholder="Auth token" autofocus>
<button type="submit">Login</button>
</form><div class="error" id="err"></div></div>
<script>if(window.location.search.includes('error'))document.getElementById('err').textContent='Invalid token'</script>
</body></html>`;

export function handleLoginRoute(req: IncomingMessage, res: ServerResponse): boolean {
  const url = req.url ?? '';
  if (url !== '/web/login') return false;

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(LOGIN_HTML);
    return true;
  }

  if (req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (params.get('token') === getAuthToken()) {
        res.writeHead(302, {
          Location: '/web',
          'Set-Cookie': `cmr_token=${encodeURIComponent(getAuthToken() ?? '')}; HttpOnly; Path=/; SameSite=Strict`,
        });
        res.end();
      } else {
        res.writeHead(302, { Location: '/web/login?error=1' });
        res.end();
      }
    });
    return true;
  }

  return false;
}
```

### 6.3 修改 `src/server.ts`

在 `createServer()` 函数最前面（stats 路由判断之后、POST 代理判断之前）插入：

```typescript
import { checkAuth } from './server/middleware/auth.js';
import { handleLoginRoute } from './server/routes/login.js';

// 在 createServer callback 最前面：
if (handleLoginRoute(req, res)) return;
```

然后在路由分发前加一行：
```typescript
if (!checkAuth(req, res)) return;
```

**注意 checkAuth 的调用位置**：必须在 handleWebRoute、handleApiConfigRoute 等受保护路由之前，但不影响 handleStatsRoute、handleLogsRoute（/stats、/logs）。

当前 server.ts 路由顺序：
```
handleWebRoute → handleApiConfigRoute → handleApiRunRoute → handleApiLogsRoute → handleStatsRoute → handleLogsRoute
```

改为：
```
handleLoginRoute → checkAuth → 然后原有顺序
```

**但** stats/logs 不应被 auth 拦截。所以 checkAuth 在 handleStatsRoute 和 handleLogsRoute 之后调用也行。更好的方案：把 checkAuth 放在受保护路由之前，stats/logs 之后：

```typescript
// server.ts createServer callback:
if (handleLoginRoute(req, res)) return;
if (handleStatsRoute(req, res)) return;    // ← 这些不过 auth
if (handleLogsRoute(req, res)) return;     // ←
if (!checkAuth(req, res)) return;           // ← 对下面的路由生效
if (handleWebRoute(req, res)) return;
if (handleApiConfigRoute(req, res)) return;
if (handleApiRunRoute(req, res)) return;
if (handleApiLogsRoute(req, res)) return;
// ... 代理逻辑不变
```

### 6.4 测试：`tests/server/middleware/auth.test.ts`

| 场景 | 断言 |
|------|------|
| 无 CMR_WEB_AUTH_TOKEN | 所有端点放行 |
| 有 token，GET /stats 无 token | 200（不拦截） |
| 有 token，GET /web 无 token | 302 或 401 |
| 有 token，GET /web 带 cookie cmr_token | 200 |
| 有 token，GET /api/config Bearer header | 200 |
| 有 token，GET /api/config 无 token | 401 |
| 有 token，POST /v1/messages 无 token | 通过（非受保护） |

### 6.5 README 补充

在 Web UI 章节的安全提示中添加：
```markdown
To enable authentication, set `CMR_WEB_AUTH_TOKEN=your-token` and restart cmr.
API clients pass `Authorization: Bearer <token>`. Browser users visit `/web/login`.
```

### 提交
```
feat: add optional token auth for Web UI and API routes
test: add auth middleware tests
docs: document CMR_WEB_AUTH_TOKEN in README
```

---

## 7. 章节 F — Stats 持久化

### 7.1 修改 `src/stats/stats-store.ts`

新增：
```typescript
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function loadStats(path: string): void {
  if (!existsSync(path)) return;
  try {
    const saved = JSON.parse(readFileSync(path, 'utf-8'));
    state = {
      ...state,
      backends: saved.backends ?? {},
      total: saved.total ?? 0,
      // startTime 不恢复，反映本次启动
    };
  } catch { /* ignore */ }
}

export function flushStats(path: string): void {
  try {
    writeFileSync(path, JSON.stringify({
      backends: state.backends,
      total: state.total,
    }), 'utf-8');
  } catch { /* ignore */ }
}
```

### 7.2 修改 `src/index.ts`

```typescript
import { loadStats, flushStats } from './stats/stats-store.js';
import { join } from 'node:path';
import { getDataDir } from './config.js';

const statsPath = join(getDataDir(), 'stats.json');
loadStats(statsPath);
const flushTimer = setInterval(() => flushStats(statsPath), 10_000);

// 在 shutdown handler 中加：
clearInterval(flushTimer);
flushStats(statsPath);
```

### 7.3 测试：`tests/stats/persistence.test.ts`

```typescript
import { loadStats, flushStats, recordRequest, resetStats, getSnapshot } from '../../src/stats/stats-store.js';
import { writeFileSync, unlinkSync } from 'node:fs';
// record → flush → load → assert count preserved
```

### 提交
```
feat: persist per-backend stats to disk across restarts
test: add stats persistence tests
```

---

## 8. 章节 G — Degraded 健康探活

### 8.1 修改 `src/stats/stats-store.ts`

新增：
```typescript
export function resetConsecutiveFailures(backendName: string): void {
  const prev = state.backends[backendName];
  if (!prev) return;
  state = {
    ...state,
    backends: {
      ...state.backends,
      [backendName]: { ...prev, consecutiveFailures: 0 },
    },
  };
}
```

### 8.2 修改 `src/index.ts`

```typescript
import { checkBackend } from './utils/http-client.js';
import { isDegraded, resetConsecutiveFailures } from './stats/stats-store.js';

const probeTimer = setInterval(async () => {
  const b = getConfig().backends;
  for (const [name, backend] of Object.entries(b)) {
    if (!isDegraded(name)) continue;
    const r = await checkBackend(name, backend.url);
    if (r.reachable) {
      resetConsecutiveFailures(name);
      console.log(`[probe] ${name} recovered`);
    }
  }
}, 60_000);

// SIGTERM/SIGINT handler 中加:
clearInterval(probeTimer);
```

### 8.3 测试

在 `tests/integration-fallback.test.ts` 加一个 case：
- 后端连续失败 3 次 → degraded → 调用 resetConsecutiveFailures → isDegraded 返回 false

### 提交
```
feat: auto-probe degraded backends every 60s for recovery
```

---

## 9. 章节 H — Pipeline 阶段超时可配置

### 9.1 修改 `src/types.ts`

```typescript
export interface PipelineStage {
  model: string;
  prompt: string;
  timeoutMs?: number;  // ← 新增
}
```

### 9.2 修改 `src/pipeline.ts`

```typescript
// runPipeline 内：
const stageTimeout = stage.timeoutMs ?? options?.timeoutPerStage ?? 300_000;
```

### 9.3 README

Pipeline Enhancements 列表增加一项。

### 提交
```
feat: allow per-stage timeoutMs in pipeline config
```

---

## 10. 章节 I — API Key 脱敏审计统一

### 10.1 新增 `src/utils/redact.ts`

```typescript
export function redactConfig(config: { backends: Record<string, { apiKey: string }> } & Record<string, unknown>) {
  return {
    ...config,
    backends: Object.fromEntries(
      Object.entries(config.backends).map(([name, b]) => [name, { ...b, apiKey: '***' }])
    ),
  };
}
```

### 10.2 修改 `src/server/routes/api-config.ts`

把 GET handler 中的手动脱敏替换为调用 `redactConfig()`。

### 10.3 审计

```bash
grep -rn "apiKey" src/ bin/ --include="*.ts" --include="*.js"
```

确认不会在 log/error response 中泄漏。

### 提交
```
refactor: extract config redaction to shared utility
test: add redact utility tests
```

---

## 11. 章节 J — 端到端集成测试

### 11.1 前置重构

`src/server/routes/api-config.ts` 将硬编码的 `CONFIG_PATH` 替换为 `getConfigPath()`：
```typescript
import { getConfig, reloadConfig, getConfigPath } from '../../config.js';
// 替换 CONFIG_PATH 常量
```

### 11.2 新增 `tests/e2e/proxy-flow.test.ts`

| # | 名称 | 描述 |
|---|------|------|
| 1 | basic proxy | POST /v1/messages → mock backend → 200 + content 透传 |
| 2 | model routing | deepseek 模型 → deepseek backend, claude 模型 → claude backend |
| 3 | alias resolution | model="opus" → 实际转发 body 含 "claude-opus-4-7" |
| 4 | fallback chain | 第一个 500 → 第二个 200 → 客户端拿 200 |
| 5 | GET /api/config | apiKey 脱敏 |
| 6 | POST /api/config | 写入 → GET 确认更新 |
| 7 | GET /web | content-type text/html |
| 8 | GET /stats | JSON，含 total、uptime、backends |
| 9 | GET /api/logs | JSON，含 logs 数组 |

用 `http.createServer` mock backend，端口传 0 让 OS 分配避免冲突。

### 提交
```
refactor: api-config uses getConfigPath() for testability
test: add e2e proxy flow integration tests
```

---

## 12. 章节 K — Changelog Tag

### 操作

确保当前 `CHANGELOG.md` 已更新（章节 D 执行完毕后）：
```bash
git tag -a v0.3.0 -m "v0.3.0: auto fallback, TUI dashboard, web UI, pipeline resilience"
npm run changelog  # 验证生成器能跑
```

**只打本地 tag，不 push 到 origin。** 发布时机由用户决定。

---

## 13. 章节 L — Windows Terminal 兼容

### 13.1 修改 `bin/cmr.js` 的 `cmdDashboard`

```js
const supportsColor = process.stdout.isTTY
  && (process.platform !== 'win32' || !!process.env['WT_SESSION'] || !!process.env['TERM']);
const red = supportsColor ? '\x1b[31m' : '';
// ... green, yellow, reset 同理
```

### 13.2 README 添加兼容说明

TUI dashboard 节加一行：
```markdown
> Tested on macOS Terminal, iTerm2, Linux xterm. Windows: use Windows Terminal (cmd.exe not supported).
```

### 提交
```
chore: graceful color fallback for Windows legacy terminals
```

---

## 14. 全局验收

### 每节完成必做

```bash
npm run lint   # tsc --noEmit，零错误
npm test       # 全部通过，数量 > 75
npm run build  # 无报错
```

### 验收清单
- [ ] A. TUI dashboard 非 TTY 保护 + 手动跑通
- [ ] B. Auto fallback 集成测试通过
- [ ] C. Pipeline abort 测试通过 + 手动 Ctrl+C 复验
- [ ] D. GitHub 仓库 README + CHANGELOG 可读
- [ ] E. Web UI 鉴权功能可用
- [ ] F. Stats 重启保留（可选）
- [ ] G. Degraded 自动恢复（可选）
- [ ] H. Pipeline 耗时配置化（可选）
- [ ] I. 脱敏无遗漏
- [ ] J. E2E 测试套件
- [ ] K. 本地 tag 已打
- [ ] L. Windows 说明已加（可选）

### 代码质量
- [ ] 所有文件 < 800 行
- [ ] 无 `ts-ignore` 新增（除已有的 monkey-patch `any`）
- [ ] 无 `.only` 残留在测试中
- [ ] `console.log` 仅在服务/CLI 入口，不在 lib 模块

---

## 15. 执行顺序

```
P0:  A → B → C → D  (D 在所有代码改动完成后 push，保证文档与代码一致)
P1:  I → J → E
P2:  F → G → H → K → L
```

## 16. 不要做的事

- 不引入任何 npm 依赖
- 不重构现有模块（除非本计划明确要求）
- 不 push git tag
- 不 publish npm
- 不新增配置文件格式
- 不修改测试框架（保持 node:test）

# claude-model-router

> Lightweight reverse proxy for Claude Code that routes requests to different LLM backends based on model name — no more switching configs and restarting.
>
> 为 Claude Code 设计的轻量反向代理。根据模型名自动将请求路由到不同的 LLM 后端，会话内通过 `/model` 一键切换，无需重启。

## Features / 特性

- **Multi-backend routing** — Route models to any number of Anthropic-compatible backends (DeepSeek, OpenRouter, etc.) by configurable regex patterns
- **Zero-dependency** — Only uses Node.js built-in modules
- **Hot reload** — Edit `config.json` without restarting the proxy
- **Config validation** — Clear error messages on invalid config
- **Request sanitization** — DeepSeek support strips unsupported fields automatically
- **Error transparency** — Upstream error details preserved in proxy responses
- **Enhanced logging** — Response status codes and latency logged per request

```
┌─────────────┐     POST /v1/messages     ┌──────────────────┐
│  Claude     │ ────────────────────────── │  cmr (port 3457) │
│  Code       │  ANTHROPIC_BASE_URL=       │                  │
│  (any       │  http://127.0.0.1:3457     │  reads model     │
│   session)  │                            │  from request    │
└─────────────┘                            └────────┬─────────┘
                                                    │
                                     ┌──────────────┴──────────────┐
                                     │                             │
                              model matches                   model matches
                              claude-*                        deepseek-*
                                     │                             │
                            ┌────────▼────────┐        ┌──────────▼──────────┐
                            │  Anthropic API  │        │  api.deepseek.com   │
                            │  /v1/messages   │        │  /anthropic/v1/     │
                            │  (passthrough)  │        │  messages           │
                            └─────────────────┘        │  (thinking stripped)│
                                                        └─────────────────────┘
```

## Quick Start

```bash
npm install -g claude-model-router
cmr setup      # Interactive config wizard (first time only)
cmr start      # Start proxy daemon
cmr status     # Verify it's running
```

If no config exists, `cmr start` and other commands will prompt you to run `cmr setup` first.

## Install / 安装

```bash
npm install -g .
# or from npm:
# npm install -g claude-model-router
```

## Configure / 配置

Create `~/.config/claude-model-router/config.json` / 创建配置文件：

```json
{
  "port": 3457,
  "logLevel": "info",
  "backends": {
    "deepseek": {
      "url": "https://api.deepseek.com",
      "apiKey": "sk-your-deepseek-key",
      "path": "/anthropic/v1/messages",
      "modelPattern": "^deepseek-"
    },
    "claude": {
      "url": "https://api.anthropic.com",
      "apiKey": "sk-ant-your-key",
      "path": "/v1/messages",
      "modelPattern": "^claude-"
    }
  },
  "aliases": {
    "dsp": "deepseek-v4-pro",
    "dsf": "deepseek-v4-flash",
    "opus": "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5"
  }
}
```

### Backend options / 后端选项

| Field | Required | Default | Description |
|---|---|---|---|
| `url` | Yes | — | Backend API base URL |
| `apiKey` | Yes | — | API key for authentication |
| `path` | No | `/v1/messages` | Request path forwarded to backend |
| `modelPattern` | No | — | Regex pattern to match model names against this backend |
| `sanitizer` | No | `"none"` | Request sanitizer (`"deepseek"` strips `thinking` field and normalizes `tool_choice`) |

### Env var overrides / 环境变量覆盖

| Env var / 环境变量 | Overrides / 覆盖 |
|---|---|
| `CMR_PORT` | `config.port` |
| `CMR_DEEPSEEK_KEY` | `config.backends.deepseek.apiKey` |
| `CMR_CLAUDE_KEY` | `config.backends.claude.apiKey` |
| `CMR_LOG_LEVEL` | `config.logLevel` |

Backend-specific env vars only affect backends named `deepseek` or `claude` (backward compatible).

## Usage / 使用

```bash
cmr setup     # Interactive config wizard (run first!)
cmr start     # 启动后台守护进程 / start background daemon
cmr status    # 检查状态 / check status
cmr stats     # Per-backend request statistics
cmr health    # Check backend reachability
cmr dashboard # Real-time monitoring dashboard (press 'q' to quit)
cmr logs      # 查看最近日志 / view recent logs
cmr stop      # 停止 / stop
cmr restart   # 重启 / restart
cmr run       # Run task through model pipeline
```

Then set in Claude Code settings / 然后在 Claude Code 设置中添加 (`~/.claude/settings.json`):

```json
"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:3457"
}
```

Now switch models mid-session with `/model` / 现在可以用 `/model` 在会话内自由切换：

```
/model opus   → claude-opus-4-7  via api.anthropic.com      (complex)
/model dsp    → deepseek-v4-pro  via api.deepseek.com  (daily driver)
/model dsf    → deepseek-v4-flash via api.deepseek.com (cheap & fast)
/model sonnet → claude-sonnet-4-6 via api.anthropic.com      (balanced)
/model haiku  → claude-haiku-4-5  via api.anthropic.com      (lightweight)
```

## v0.3.0 Features / 新功能

### Stats & Health Monitoring

**`cmr stats`** shows per-backend request counts, failure tracking, and uptime:

```
Proxy Statistics
──────────────────────────────────────────────────
Total requests: 42
Uptime:         2h 34m 12s

Per-backend stats:
  Backend           Requests    Last Request
  deepseek          28          2026-05-25T14:22:10Z
  claude            14          2026-05-25T14:22:08Z
```

**`cmr health`** checks every backend's reachability:

```
Backend Health Check
──────────────────────────────────────────────────
✓ deepseek        OK     https://api.deepseek.com
✓ claude          OK     https://api.anthropic.com
```

### Auto Fallback / 自动容灾

When a backend returns 401/403/5xx or connection errors, cmr automatically retries with the next matching backend. After 3 consecutive failures, a backend is marked as **degraded** and temporarily skipped.

```bash
cmr stats  # Check failure counts and degraded status
```

### Real-time Dashboard / 实时面板

**`cmr dashboard`** provides a live terminal dashboard with backend health, request stats, and recent logs — all updating every second. Press `q` to quit.

### Web Management UI

Visit `http://127.0.0.1:3457/web` for a browser-based management interface:
- View stats and backend health
- Edit configuration with save and reload
- Run pipeline tasks
- Watch live logs

### Pipeline Enhancements

- **Multi-input modes**: `cmr run` (interactive), `cmr run <task>`, `cmr run --file task.txt`, `echo "task" | cmr run --stdin`
- **Progress output**: `[1/4] plan (deepseek-v4-pro) completed in 12.3s`
- **Fault tolerance**: Per-stage timeout, error recovery, Ctrl+C checkpoint & resume
- **Resume**: `cmr run resume <run-id>` continues from last saved stage

### Hot Reload / 配置热重载

Edit `config.json` anytime — cmr detects file changes and reloads automatically. No restart needed, no active sessions interrupted.

### Multi-Backend Routing / 多后端路由

Add any number of backends with arbitrary names. Each backend declares a `modelPattern` (regex) to control which models it handles.

### Config Validation / 配置校验

On startup and hot reload, cmr validates every config field. Invalid config on reload keeps the previous working version.

## Custom aliases / 自定义别名

Edit the `aliases` section in your config / 编辑配置中的 `aliases` 字段：

```json
{
  "aliases": {
    "fast": "deepseek-v4-flash",
    "cheap": "deepseek-v4-flash",
    "thinking": "claude-opus-4-7"
  }
}
```

## Upgrade from v0.1.x / 从 v0.1.x 升级

cmr v0.2.0 is fully backward-compatible with your existing `config.json`. On first load:

1. The old `backends` format (with `url` + `apiKey` only) is auto-migrated to the new format with default `path`, `modelPattern`, and `sanitizer` values
2. Environment variables `CMR_DEEPSEEK_KEY` and `CMR_CLAUDE_KEY` still work
3. Logging now displays backend URL hostnames instead of hardcoded service names
4. The hot reload watcher is automatically active — no configuration needed

## Tech / 技术栈

- **Runtime**: Node.js ≥ 18 (ESM)
- **Language**: TypeScript (strict mode)
- **Dependencies**: 0 runtime dependencies
- **Test**: Node.js built-in test runner, 75 tests across 23 suites
- **Dist**: npm package with `cmr` CLI

## License / 许可

MIT

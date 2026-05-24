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
cmr start     # 启动后台守护进程 / start background daemon
cmr status    # 检查状态 / check status
cmr logs      # 查看最近日志 / view recent logs
cmr stop      # 停止 / stop
cmr restart   # 重启 / restart
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

## v0.2.0 New Features / 新功能

### Hot Reload / 配置热重载

Edit `config.json` anytime — cmr detects file changes and reloads automatically. No restart needed, no active sessions interrupted.

```bash
# Edit the config while cmr is running
vi ~/.config/claude-model-router/config.json

# Log should show: [config] detected change, reloading...
cmr logs
```

If the new config is invalid (bad JSON, validation failure), cmr keeps the previous working config and logs a warning — your proxy stays up.

### Multi-Backend Routing / 多后端路由

Add any number of backends with arbitrary names. Each backend declares a `modelPattern` (regex) to control which models it handles. Models are matched in order of declaration.

Example with a third backend (OpenRouter):

```json
{
  "backends": {
    "deepseek": {
      "url": "https://api.deepseek.com",
      "apiKey": "sk-ds-...",
      "modelPattern": "^deepseek-"
    },
    "openrouter": {
      "url": "https://openrouter.ai/api/v1",
      "apiKey": "sk-or-...",
      "modelPattern": "^(gpt|claude-3)"
    },
    "claude": {
      "url": "https://api.anthropic.com",
      "apiKey": "sk-ant-...",
      "modelPattern": "^claude-"
    }
  },
  "aliases": {
    "gpt4": "gpt-4o",
    "opus": "claude-opus-4-7",
    "cl35": "claude-3-5-sonnet-20241022",
    "dsp": "deepseek-v4-pro"
  }
}
```

### Config Validation / 配置校验

On startup, cmr validates every config field:

- **Port**: Must be a number between 1–65535
- **URL**: Must be a valid URL (parsed by `new URL()`)
- **apiKey**: Must be a string
- **Backends**: At least one backend required

Invalid config produces a clear error message and exits immediately:

```
Config validation failed:
  - port: must be a number between 1-65535
  - backends: must have at least one backend
```

### Better Error Transparency / 错误透传

When an upstream request fails, the proxy now includes the actual error details in the 502 response body:

```json
{
  "error": {
    "message": "upstream request failed",
    "details": "connect ECONNREFUSED 127.0.0.1:8080",
    "backend": "https://api.deepseek.com"
  }
}
```

### Enhanced Logging / 增强日志

Every proxied request now logs response status code and latency:

```
[2026-05-24T12:00:00.000Z] opus→claude-opus-4-7 → api.anthropic.com 200 342ms
[2026-05-24T12:00:01.000Z] dsp→deepseek-v4-pro → api.deepseek.com 200 891ms
```

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
- **Test**: Node.js built-in test runner, 43 tests across 10 suites
- **Dist**: npm package with `cmr` CLI

## License / 许可

MIT

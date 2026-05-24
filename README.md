# claude-model-router

> Lightweight reverse proxy for Claude Code that routes requests to different LLM backends based on model name — no more switching configs and restarting.
>
> 为 Claude Code 设计的轻量反向代理。根据模型名自动将请求路由到不同的 LLM 后端，会话内通过 `/model` 一键切换，无需重启。

## How it works / 工作原理

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
                              claude-*                      deepseek-*
                                     │                             │
                            ┌────────▼────────┐        ┌──────────▼──────────┐
                            │  api.anthropic.com     │        │  api.deepseek.com   │
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
      "apiKey": "sk-your-deepseek-key"
    },
    "claude": {
      "url": "https://api.anthropic.com",
      "apiKey": "sk-your-api.anthropic.com-key"
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

Keys can also be set via env vars / 也可以用环境变量设置：

| Env var / 环境变量 | Overrides / 覆盖 |
|---|---|
| `CMR_PORT` | `config.port` |
| `CMR_DEEPSEEK_KEY` | `config.backends.deepseek.apiKey` |
| `CMR_CLAUDE_KEY` | `config.backends.claude.apiKey` |
| `CMR_LOG_LEVEL` | `config.logLevel` |

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
/model opus   → claude-opus-4-7  via api.anthropic.com       (复杂任务)
/model dsp    → deepseek-v4-pro  via api.deepseek.com  (主力)
/model dsf    → deepseek-v4-flash via api.deepseek.com (便宜快速)
/model sonnet → claude-sonnet-4-6 via api.anthropic.com       (均衡)
/model haiku  → claude-haiku-4-5  via api.anthropic.com       (轻量)
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

## License / 许可

MIT

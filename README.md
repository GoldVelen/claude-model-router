# claude-model-router

> Lightweight reverse proxy for Claude Code that routes requests to different LLM backends based on model name — no more switching configs and restarting.

## How it works

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

## Install

```bash
npm install -g .
# or from npm:
# npm install -g claude-model-router
```

## Configure

Create `~/.config/claude-model-router/config.json`:

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

Keys can also be set via env vars:

| Env var | Overrides |
|---|---|
| `CMR_PORT` | `config.port` |
| `CMR_DEEPSEEK_KEY` | `config.backends.deepseek.apiKey` |
| `CMR_CLAUDE_KEY` | `config.backends.claude.apiKey` |
| `CMR_LOG_LEVEL` | `config.logLevel` |

## Usage

```bash
# Start the proxy (background daemon)
cmr start

# Check status
cmr status

# View recent logs
cmr logs

# Stop
cmr stop

# Restart
cmr restart
```

Then set in Claude Code settings (`~/.claude/settings.json`):

```json
"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:3457"
}
```

Now switch models mid-session with `/model`:

```
/model opus   → claude-opus-4-7 via api.anthropic.com
/model dsp    → deepseek-v4-pro via api.deepseek.com
/model dsf    → deepseek-v4-flash via api.deepseek.com
/model sonnet → claude-sonnet-4-6 via api.anthropic.com
/model haiku  → claude-haiku-4-5 via api.anthropic.com
```

## Add custom aliases

Edit the `aliases` section in your config:

```json
{
  "aliases": {
    "fast": "deepseek-v4-flash",
    "cheap": "deepseek-v4-flash",
    "thinking": "claude-opus-4-7"
  }
}
```

## License

MIT

# claude-model-router

> 为 Claude Code 设计的轻量反向代理。根据模型名自动将请求路由到不同的 LLM 后端，会话内通过 `/model` 一键切换，无需重启。
>
> [English](./README.md)

## 特性

- **多后端路由** — 通过可配置的正则表达式将模型路由到任意数量的 Anthropic 兼容后端（DeepSeek、OpenRouter 等）
- **零依赖** — 仅使用 Node.js 内置模块
- **热重载** — 编辑 `config.json` 无需重启代理
- **配置校验** — 无效配置时给出清晰的错误信息
- **请求净化** — DeepSeek 支持自动剥离不支持的字段
- **错误透明** — 上游错误详情保留在代理响应中
- **增强日志** — 每次请求记录响应状态码和延迟

```
┌─────────────┐     POST /v1/messages     ┌──────────────────┐
│  Claude     │ ────────────────────────── │  cmr (端口 3457) │
│  Code       │  ANTHROPIC_BASE_URL=       │                  │
│  (任意      │  http://127.0.0.1:3457     │  从请求中读取    │
│   会话)     │                            │  模型名          │
└─────────────┘                            └────────┬─────────┘
                                                    │
                                     ┌──────────────┴──────────────┐
                                     │                             │
                              模型匹配                         模型匹配
                              claude-*                        deepseek-*
                                     │                             │
                            ┌────────▼────────┐        ┌──────────▼──────────┐
                            │  Anthropic API  │        │  api.deepseek.com   │
                            │  /v1/messages   │        │  /anthropic/v1/     │
                            │  (直通)         │        │  messages           │
                            └─────────────────┘        │  (移除 thinking)    │
                                                        └─────────────────────┘
```

## 快速开始

```bash
npm install -g claude-model-router
cmr setup      # 交互式配置向导（仅首次）
cmr start      # 启动后台守护进程
cmr status     # 验证是否运行中
```

如果尚未创建配置文件，`cmr start` 及其他命令会提示你先运行 `cmr setup`。

启动后访问 `http://127.0.0.1:3457/web` 进入 Web 管理界面。

## 安装

```bash
npm install -g .
# 或从 npm：
# npm install -g claude-model-router
```

## 配置

创建 `~/.config/claude-model-router/config.json`：

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

### 后端选项

| 字段 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `url` | 是 | — | 后端 API 基础 URL |
| `apiKey` | 是 | — | 认证 API 密钥 |
| `path` | 否 | `/v1/messages` | 转发到后端的请求路径 |
| `modelPattern` | 否 | — | 匹配模型名的正则表达式 |
| `sanitizer` | 否 | `"none"` | 请求净化器（`"deepseek"` 剥离 `thinking` 字段并规范化 `tool_choice`） |

### 环境变量覆盖

| 环境变量 | 覆盖 |
|---|---|
| `CMR_PORT` | `config.port` |
| `CMR_DEEPSEEK_KEY` | `config.backends.deepseek.apiKey` |
| `CMR_CLAUDE_KEY` | `config.backends.claude.apiKey` |
| `CMR_LOG_LEVEL` | `config.logLevel` |

后端专属环境变量仅影响名为 `deepseek` 或 `claude` 的后端（向后兼容）。

## 使用

```bash
cmr setup     # 交互式配置向导（首次运行！）
cmr start     # 启动后台守护进程
cmr status    # 检查状态
cmr stats     # 各后端请求统计
cmr health    # 检查后端可达性
cmr dashboard # 实时监控面板（按 'q' 退出）
cmr logs      # 查看最近日志
cmr stop      # 停止
cmr restart   # 重启
cmr run       # 通过模型流水线运行任务
```

然后在 Claude Code 设置中添加（`~/.claude/settings.json`）：

```json
"env": {
  "ANTHROPIC_BASE_URL": "http://127.0.0.1:3457"
}
```

现在可以用 `/model` 在会话内自由切换模型：

```
/model opus   → claude-opus-4-7  via api.anthropic.com      (复杂任务)
/model dsp    → deepseek-v4-pro  via api.deepseek.com  (日常主力)
/model dsf    → deepseek-v4-flash via api.deepseek.com (便宜快速)
/model sonnet → claude-sonnet-4-6 via api.anthropic.com      (均衡)
/model haiku  → claude-haiku-4-5  via api.anthropic.com      (轻量)
```

## v0.3.0 新功能

### 统计与健康监控

**`cmr stats`** 显示各后端请求数、故障追踪和运行时长：

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

**`cmr health`** 检查每个后端的可达性：

```
Backend Health Check
──────────────────────────────────────────────────
✓ deepseek        OK     https://api.deepseek.com
✓ claude          OK     https://api.anthropic.com
```

### 自动容灾

当后端返回 401/403/5xx 或连接错误时，cmr 自动尝试下一个匹配的后端。连续 3 次失败后，后端标记为**已降级**并暂时跳过。

```bash
cmr stats  # 查看故障计数和降级状态
```

### 实时面板

**`cmr dashboard`** 提供实时终端面板，展示后端健康、请求统计和最近日志，每秒更新。按 `q` 退出。需要至少 80 列宽的交互式终端。

### Web 管理界面

访问 `http://127.0.0.1:3457/web` 进入浏览器管理界面：
- 查看统计和后端健康状态
- 编辑配置并保存重载
- 运行流水线任务
- 实时日志

> **安全提示**：Web 界面仅绑定 localhost。不要将 3457 端口暴露到公网。

### 流水线增强

- **多种输入模式**：`cmr run`（交互式）、`cmr run <任务>`、`cmr run --file task.txt`、`echo "task" | cmr run --stdin`
- **进度输出**：`[1/4] plan (deepseek-v4-pro) completed in 12.3s`
- **容错**：每阶段超时、错误恢复、Ctrl+C 保存检查点并恢复
- **恢复**：`cmr run resume <run-id>` 从上次保存的阶段继续

### 热重载

随时编辑 `config.json` —— cmr 检测文件变更并自动重载。无需重启，不影响活跃会话。

### 多后端路由

添加任意数量、任意名称的后端。每个后端通过 `modelPattern`（正则）声明处理的模型范围。

### 配置校验

启动和热重载时，cmr 校验每个配置字段。重载时遇到无效配置会保留上一个可用版本。

## 自定义别名

编辑配置中的 `aliases` 字段：

```json
{
  "aliases": {
    "fast": "deepseek-v4-flash",
    "cheap": "deepseek-v4-flash",
    "thinking": "claude-opus-4-7"
  }
}
```

## 从 v0.1.x 升级

cmr v0.3.0 完全向后兼容 v0.1.x 和 v0.2.x 的配置。首次加载时：

1. 旧 `backends` 格式（仅含 `url` + `apiKey`）自动迁移为新格式，补充默认的 `path`、`modelPattern` 和 `sanitizer`
2. 环境变量 `CMR_DEEPSEEK_KEY` 和 `CMR_CLAUDE_KEY` 仍然有效
3. 日志现在显示后端 URL 主机名，而非硬编码的服务名
4. 热重载监视器自动激活 —— 无需额外配置

## 架构

```
src/
├── server.ts             HTTP 服务器，含重试循环和容灾
├── router.ts             后端选择（modelPattern + 降级过滤）
├── pipeline.ts           多阶段模型编排
├── config.ts             配置加载 + 热重载 + 环境变量覆盖
├── watcher.ts            监听 config.json 的 fs.watch
├── validator.ts          配置 schema 校验
├── sanitize.ts           DeepSeek 请求净化器
├── stats/                各后端指标（不可变存储）
│   ├── stats-store.ts    状态 + recordRequest/recordFailure/isDegraded
│   ├── stats-middleware.ts res.writeHead/end 拦截
│   └── stats-types.ts
├── server/routes/        HTTP 端点
│   ├── stats.ts          GET /stats
│   ├── logs.ts           GET /logs
│   ├── web.ts            GET /web（提供 public/index.html）
│   ├── api-config.ts     GET/POST /api/config
│   ├── api-run.ts        POST /api/run, GET /api/run/:id
│   └── api-logs.ts       GET /api/logs
├── commands/             CLI 命令（由 bin/cmr.js 调用）
│   ├── stats.ts
│   └── health.ts
└── utils/
    ├── http-client.ts    后端可达性检查
    └── changelog-generator.ts
```

零运行时依赖 —— 仅使用 Node.js 内置模块。

## 技术栈

- **运行时**：Node.js ≥ 18（ESM）
- **语言**：TypeScript（严格模式）
- **依赖**：0 运行时依赖
- **测试**：Node.js 内置测试运行器，88 个测试用例，27 个测试套件
- **分发**：npm 包，包含 `cmr` CLI

## 许可

MIT

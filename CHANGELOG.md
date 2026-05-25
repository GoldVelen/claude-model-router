# Changelog

[English](#english) | [中文](#中文)

---

## English

### v0.3.0

#### Features

- auto fallback with degraded backend tracking
- TUI dashboard (real-time health, stats, logs)
- Web management UI at /web with bilingual support (EN/ZH)
- stats/health monitoring (cmr stats, cmr health)
- pipeline progress output, per-stage timeout, and Ctrl+C checkpoint/resume
- multi-input pipeline modes (interactive, --file, --stdin, args)
- setup guard prompts for setup if config missing
- Web UI authentication middleware (token via env var or cookie)
- log refresh button with auto-refresh toggle
- bilingual WebUI with language switcher (English / 中文)

#### Bug Fixes

- correct public/index.html path resolution in web route
- dashboard non-TTY guard
- pipeline SIGINT now aborts mid-stage via AbortSignal
- fix stats test import path and missing afterEach

### v0.2.0

#### Features

- pipeline engine for auto model dispatch
- multi-backend routing with modelPattern
- config validation and hot reload
- CLI daemon, setup and pipeline commands

#### Bug Fixes

- empty PID file falsely detected as running
- strict plan-to-implementation pipeline discipline

#### Documentation

- bilingual README (EN/CN)

### v0.1.0

- initial release

---

## 中文

### v0.3.0

#### 新增

- 自动故障转移与后端降级追踪
- TUI 仪表板（实时健康状态、统计数据、日志）
- Web 管理界面（/web），支持中英文双语切换
- 统计/健康监控（cmr stats、cmr health）
- 流水线进度输出、分阶段超时、Ctrl+C 检查点/恢复
- 多输入流水线模式（交互、--file、--stdin、args）
- 缺少配置时提示运行 cmr setup
- Web UI 认证中间件（通过环境变量或 cookie 验证 token）
- 日志刷新按钮及自动刷新开关
- 双语 WebUI 界面及语言切换器（English / 中文）

#### 修复

- 修正 web 路由中 public/index.html 路径解析
- 仪表板非 TTY 环境保护
- 流水线 SIGINT 现在通过 AbortSignal 中止当前阶段
- 修复 stats 测试的导入路径和缺失的 afterEach

### v0.2.0

#### 新增

- 自动模型调度的流水线引擎
- 基于 modelPattern 的多后端路由
- 配置验证和热重载
- CLI 守护进程、设置和流水线命令

#### 修复

- 空 PID 文件被误判为运行中
- 严格的计划到实现流水线规范

#### 文档

- 双语 README（中/英）

### v0.1.0

- 初始版本

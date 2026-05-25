# DeepSeek 执行计划 - Claude Model Router v0.3.0

## 📋 任务概览

本文档为 DeepSeek AI 提供详细的执行指导，完成 Claude Model Router 项目的两个待办任务。

**项目路径**: `/Users/velen/projects/claude-model-router`

**任务列表**:
- **任务 N**: Web 后台日志实时同步/刷新按钮（优先执行）
- **任务 M**: WebUI/Git 文档双语模式
- **任务 O**: Pipeline 自动执行功能（核心功能）

**预计总时间**: 5-7 小时

---

## 🎯 执行顺序

### 阶段 1: 任务 N - 日志刷新功能（0.5-1h）
### 阶段 2: 任务 M - 双语支持（2-3h）
### 阶段 3: 任务 O - Pipeline 自动执行（2-3h）

**为什么先做任务 N？**
1. 功能简单，风险低，可快速验证
2. 为任务 M 的双语标记做准备
3. 可以立即改善用户体验

**为什么任务 O 放最后？**
1. 依赖前两个任务的 UI 改进
2. 是核心功能，需要充分测试
3. 涉及文件系统操作，需要谨慎实施

---

## 📝 阶段 1: 任务 N - 日志刷新功能

### 目标
为 Web 后台的日志区域添加手动刷新按钮和自动刷新开关。

### 文件修改清单
- `public/index.html` (唯一需要修改的文件)

### 详细实施步骤

#### 步骤 N1: 备份原文件
```bash
cd /Users/velen/projects/claude-model-router
cp public/index.html public/index.html.backup
```

#### 步骤 N2: 修改日志卡片 HTML 结构

**位置**: 在 `public/index.html` 中找到日志卡片部分

**查找内容**:
```html
<div class="card full">
  <h2>Recent Logs</h2>
  <div id="log-container">Loading...</div>
</div>
```

**替换为**:
```html
<div class="card full">
  <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
    <h2 style="margin:0;">
      <span data-lang="en">Recent Logs</span>
      <span data-lang="zh">最近日志</span>
    </h2>
    <div style="display:flex; gap:8px; align-items:center;">
      <label style="font-size:12px; color:#888; display:flex; align-items:center; gap:4px;">
        <input type="checkbox" id="auto-refresh-logs" checked onchange="toggleAutoRefresh()">
        <span data-lang="en">Auto-refresh</span>
        <span data-lang="zh">自动刷新</span>
      </label>
      <button onclick="refreshLogs()" style="padding:4px 12px; font-size:12px;">
        <span data-lang="en">Refresh</span>
        <span data-lang="zh">刷新</span>
      </button>
      <span id="log-last-update" style="font-size:11px; color:#666;"></span>
    </div>
  </div>
  <div id="log-container">
    <span data-lang="en">Loading...</span>
    <span data-lang="zh">加载中...</span>
  </div>
</div>
```

#### 步骤 N3: 更新 JavaScript 日志刷新逻辑

**位置**: 在 `<script>` 标签中

**3.1 添加全局变量**（在 script 标签开头添加）:
```javascript
let autoRefreshEnabled = true;
let logRefreshInterval = null;
```

**3.2 修改现有的 `refreshLogs()` 函数**:

**查找**:
```javascript
async function refreshLogs() {
  try {
    const r = await fetch('/api/logs');
    const d = await r.json();
    const container = document.getElementById('log-container');
    const logs = (d.logs || []).slice(-30);
    container.innerHTML = logs.length ? logs.map(l => `<div>${esc(l)}</div>`).join('') : '<div style="color:#666;">(no logs)</div>';
    container.scrollTop = container.scrollHeight;
  } catch(e) {}
}
```

**替换为**:
```javascript
async function refreshLogs() {
  try {
    const r = await fetch('/api/logs');
    const d = await r.json();
    const container = document.getElementById('log-container');
    const logs = (d.logs || []).slice(-30);
    
    if (logs.length === 0) {
      container.innerHTML = `<div style="color:#666;"><span data-lang="en">(no logs)</span><span data-lang="zh">（无日志）</span></div>`;
    } else {
      container.innerHTML = logs.map(l => `<div>${esc(l)}</div>`).join('');
      container.scrollTop = container.scrollHeight;
    }
    
    // 更新最后刷新时间
    const now = new Date().toLocaleTimeString();
    document.getElementById('log-last-update').textContent = now;
  } catch(e) {
    console.error('Failed to refresh logs:', e);
  }
}
```

**3.3 添加新函数**（在 `refreshLogs()` 函数后添加）:
```javascript
function toggleAutoRefresh() {
  autoRefreshEnabled = document.getElementById('auto-refresh-logs').checked;
  localStorage.setItem('cmr-auto-refresh-logs', autoRefreshEnabled);
  
  if (autoRefreshEnabled) {
    startLogRefresh();
  } else {
    stopLogRefresh();
  }
}

function startLogRefresh() {
  if (logRefreshInterval) return;
  logRefreshInterval = setInterval(refreshLogs, 2000);
}

function stopLogRefresh() {
  if (logRefreshInterval) {
    clearInterval(logRefreshInterval);
    logRefreshInterval = null;
  }
}
```

**3.4 修改页面初始化代码**:

**查找**（通常在 script 标签末尾）:
```javascript
setInterval(()=>{refreshStats();refreshLogs();}, 2000);
refreshStats(); refreshLogs();
```

**替换为**:
```javascript
(function init() {
  // 恢复自动刷新设置
  const savedAutoRefresh = localStorage.getItem('cmr-auto-refresh-logs');
  if (savedAutoRefresh !== null) {
    autoRefreshEnabled = savedAutoRefresh === 'true';
    document.getElementById('auto-refresh-logs').checked = autoRefreshEnabled;
  }
  
  // 启动统计刷新（保持 2 秒间隔）
  setInterval(refreshStats, 2000);
  
  // 启动日志刷新（如果启用）
  if (autoRefreshEnabled) {
    startLogRefresh();
  }
  
  // 立即刷新一次
  refreshStats();
  refreshLogs();
})();
```

#### 步骤 N4: 测试任务 N

**启动服务器**:
```bash
npm start
```

**测试清单**:
- [ ] 打开浏览器访问 `http://localhost:3000`
- [ ] 点击"Refresh"按钮，日志应立即更新
- [ ] 最后刷新时间应显示当前时间
- [ ] 取消勾选"Auto-refresh"，等待 2 秒，日志应停止更新
- [ ] 重新勾选"Auto-refresh"，日志应恢复自动更新
- [ ] 刷新浏览器页面，自动刷新设置应保持
- [ ] 打开浏览器控制台，确认没有 JavaScript 错误

#### 步骤 N5: 提交任务 N

```bash
git add public/index.html
git commit -m "feat: add manual refresh and auto-refresh toggle for logs

- Add 'Refresh Logs' button to logs card
- Add 'Auto-refresh' checkbox with localStorage persistence
- Display last refresh timestamp
- Separate log refresh logic from stats refresh
- Support bilingual UI (EN/ZH)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 📝 阶段 2: 任务 M - 双语支持

### 目标
为 WebUI 和 Git 文档添加中英文切换功能。

### 文件修改清单
- `public/index.html` (主要修改)
- `CHANGELOG.md` (添加中文翻译)
- `README.md` (可选，已有双语内容)

### 详细实施步骤

#### 步骤 M1: 添加语言切换样式

**位置**: 在 `public/index.html` 的 `<style>` 标签中添加

**在现有样式末尾添加**:
```css
/* 语言切换器样式 */
.lang-switcher {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 1000;
}
.lang-btn {
  background: #1a1a1a;
  border: 1px solid #333;
  color: #888;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}
.lang-btn:hover {
  border-color: #555;
  color: #e0e0e0;
}
.lang-btn.active {
  background: #2563eb;
  border-color: #2563eb;
  color: #fff;
}

/* 语言切换逻辑 */
[data-lang]:not([data-lang="en"]) { display: none; }
body.lang-zh [data-lang="en"] { display: none; }
body.lang-zh [data-lang="zh"] { display: inline; }
body.lang-en [data-lang="zh"] { display: none; }
body.lang-en [data-lang="en"] { display: inline; }
```

#### 步骤 M2: 添加语言切换按钮

**位置**: 在 `<body>` 标签开头（第一个元素）

**添加内容**:
```html
<div class="lang-switcher">
  <button class="lang-btn" data-lang-btn="en" onclick="switchLang('en')">English</button>
  <button class="lang-btn" data-lang-btn="zh" onclick="switchLang('zh')">中文</button>
</div>
```

#### 步骤 M3: 双语化所有文本内容

**需要修改的文本对照表**:

| 位置 | 英文 | 中文 |
|---|---|---|
| 标题 | Claude Model Router | Claude 模型路由器 |
| 状态行 | Connecting... | 连接中... |
| 状态行 | Connected | 已连接 |
| 卡片标题 | Status | 状态 |
| 统计项 | Total Requests | 总请求数 |
| 统计项 | Uptime | 运行时长 |
| 统计项 | Started | 启动时间 |
| 统计项 | HTTP Port | HTTP 端口 |
| 卡片标题 | Backend Health | 后端健康状态 |
| 表头 | Backend | 后端 |
| 表头 | Status | 状态 |
| 表头 | Requests | 请求数 |
| 表头 | Last | 最后请求 |
| 占位符 | No data | 无数据 |
| 占位符 | No backends configured | 未配置后端 |
| 卡片标题 | Configuration | 配置 |
| 按钮 | Refresh | 刷新 |
| 按钮 | Save | 保存 |
| 提示 | Saved! | 已保存！ |
| 错误 | Failed to load config | 加载配置失败 |
| 卡片标题 | Pipeline Runner | 流水线运行器 |
| 占位符 | Enter task description... | 输入任务描述... |
| 按钮 | Run Pipeline | 运行流水线 |
| 状态 | Running... | 运行中... |
| 状态 | Submitted | 已提交 |
| 状态 | Failed | 失败 |

**修改示例**:

**原来**:
```html
<h1>Claude Model Router</h1>
```

**改为**:
```html
<h1>
  <span data-lang="en">Claude Model Router</span>
  <span data-lang="zh">Claude 模型路由器</span>
</h1>
```

**原来**:
```html
<p class="subtitle" id="status-line">Connecting...</p>
```

**改为**:
```html
<p class="subtitle" id="status-line">
  <span data-lang="en">Connecting...</span>
  <span data-lang="zh">连接中...</span>
</p>
```

**重要提示**: 
- 所有可见的静态文本都需要用 `<span data-lang="en">` 和 `<span data-lang="zh">` 包裹
- 动态生成的内容（JavaScript 中的字符串）也需要双语化
- 保持 HTML 结构不变，只添加 span 标签

#### 步骤 M4: 添加语言切换 JavaScript 逻辑

**位置**: 在 `<script>` 标签末尾添加

**添加内容**:
```javascript
// 语言切换逻辑
function switchLang(lang) {
  document.body.className = `lang-${lang}`;
  localStorage.setItem('cmr-lang', lang);
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.langBtn === lang);
  });
}

// 页面加载时应用保存的语言设置
(function initLang() {
  const saved = localStorage.getItem('cmr-lang');
  const browserLang = navigator.language.toLowerCase();
  const defaultLang = saved || (browserLang.startsWith('zh') ? 'zh' : 'en');
  switchLang(defaultLang);
})();
```

**注意**: 这段代码应该在页面初始化代码之后添加，确保 DOM 已经加载完成。

#### 步骤 M5: 更新 CHANGELOG.md 添加中文翻译

**位置**: `CHANGELOG.md` 文件

**在文件开头添加语言切换链接**:
```markdown
# Changelog

[English](#english) | [中文](#中文)

---

## English

(保留现有的英文内容)

---

## 中文

### [0.3.0] - 2026-05-25

#### 新增
- Web UI 认证中间件
- 日志手动刷新和自动刷新开关
- WebUI 双语支持（中英文切换）
- 后端健康状态监控
- 配置热重载功能

#### 修复
- 修复日志刷新性能问题
- 修复配置保存错误处理

#### 改进
- 优化 WebUI 响应速度
- 改进错误消息显示
- 增强用户体验

(根据现有 CHANGELOG.md 的英文内容翻译其他版本)
```

#### 步骤 M6: 测试任务 M

**启动服务器**:
```bash
npm start
```

**测试清单**:
- [ ] 打开浏览器访问 `http://localhost:3000`
- [ ] 点击右上角"English"按钮，页面应显示英文
- [ ] 点击"中文"按钮，页面应显示中文
- [ ] 刷新页面，语言设置应保持
- [ ] 清除浏览器 localStorage，刷新页面，应根据浏览器语言自动选择
- [ ] 检查所有文本是否都有对应的双语版本
- [ ] 检查动态生成的内容（状态、错误消息）是否正确显示对应语言
- [ ] 检查样式在两种语言下是否都正常
- [ ] 打开浏览器控制台，确认没有 JavaScript 错误

#### 步骤 M7: 提交任务 M

```bash
git add public/index.html CHANGELOG.md
git commit -m "feat: add bilingual support to WebUI and docs

- Add language switcher (EN/ZH) to WebUI
- Implement localStorage-based language preference
- Auto-detect browser language on first visit
- Update CHANGELOG.md with bilingual format
- All UI text now supports English and Chinese

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 🔍 完整测试清单

### 任务 N 测试
- [ ] 手动刷新按钮正常工作
- [ ] 自动刷新开关正常工作
- [ ] 刷新页面后自动刷新设置保持
- [ ] 最后刷新时间正确显示
- [ ] 日志滚动到底部
- [ ] 网络错误时不会中断自动刷新

### 任务 M 测试
- [ ] 语言切换按钮正常工作
- [ ] 刷新页面后语言设置保持
- [ ] 浏览器语言检测正常（中文浏览器默认显示中文）
- [ ] 所有静态文本都有双语版本
- [ ] 动态生成的文本也正确显示对应语言
- [ ] 样式在两种语言下都正常
- [ ] CHANGELOG.md 双语格式正确

### 集成测试
- [ ] 两个功能同时工作正常
- [ ] 切换语言后，日志刷新功能的文本也切换
- [ ] 没有 JavaScript 错误
- [ ] 没有样式冲突
- [ ] 页面性能正常

---

## ⚠️ 常见问题和解决方案

### 问题 1: 找不到要修改的代码
**解决方案**: 使用文本编辑器的搜索功能（Ctrl+F 或 Cmd+F）查找关键字

### 问题 2: 修改后页面显示异常
**解决方案**: 
1. 检查 HTML 标签是否正确闭合
2. 检查 JavaScript 语法是否正确
3. 打开浏览器控制台查看错误信息
4. 恢复备份文件重新开始

### 问题 3: 语言切换不生效
**解决方案**:
1. 检查 CSS 样式是否正确添加
2. 检查 `switchLang()` 函数是否正确定义
3. 清除浏览器缓存后重试
4. 检查浏览器控制台是否有 JavaScript 错误

### 问题 4: 自动刷新不工作
**解决方案**:
1. 检查 `setInterval` 是否被正确清除和重新设置
2. 检查 `autoRefreshEnabled` 变量是否正确更新
3. 检查 localStorage 是否可用
4. 打开浏览器控制台查看错误信息

---

## 📊 预期成果

### 任务 N 完成后
- ✅ 日志区域有"刷新"按钮
- ✅ 日志区域有"自动刷新"开关
- ✅ 显示最后刷新时间
- ✅ 用户偏好被保存到 localStorage

### 任务 M 完成后
- ✅ WebUI 右上角有语言切换按钮
- ✅ 所有文本支持中英文切换
- ✅ 语言偏好被保存
- ✅ 自动检测浏览器语言
- ✅ CHANGELOG.md 有中文翻译

### 最终效果
- ✅ 用户可以选择界面语言
- ✅ 用户可以控制日志刷新行为
- ✅ 所有设置在刷新页面后保持
- ✅ 代码质量良好，无明显 bug

---

## 🚀 执行建议

### 给 DeepSeek 的建议

1. **按顺序执行**: 先完成任务 N，测试通过后再开始任务 M
2. **小步提交**: 每完成一个任务就提交一次，不要等到全部完成
3. **充分测试**: 每个步骤完成后都要测试，确保功能正常
4. **保留备份**: 修改前备份原文件，出错时可以快速恢复
5. **注意细节**: HTML 标签要正确闭合，JavaScript 语法要正确
6. **查看控制台**: 遇到问题时第一时间查看浏览器控制台的错误信息

### 时间分配建议

- 任务 N: 30-60 分钟
  - 修改 HTML: 10 分钟
  - 修改 JavaScript: 15 分钟
  - 测试: 10 分钟
  - 提交: 5 分钟

- 任务 M: 2-3 小时
  - 添加样式和按钮: 15 分钟
  - 双语化所有文本: 60-90 分钟（最耗时）
  - 添加 JavaScript 逻辑: 15 分钟
  - 更新 CHANGELOG: 20 分钟
  - 测试: 20 分钟
  - 提交: 5 分钟

---

## 📞 需要帮助？

如果在执行过程中遇到问题：

1. **检查本文档**: 查看"常见问题和解决方案"部分
2. **查看参考文件**: 
   - `IMPLEMENTATION_GUIDE_v0.3.0_M_N.md` - 详细技术方案
   - `SESSION_REPORT_v0.3.0_R5.md` - 项目背景
3. **查看代码**: 仔细阅读现有代码，理解其结构
4. **使用搜索**: 在项目中搜索相关代码片段

---

## 📝 阶段 3: 任务 O - Pipeline 自动执行功能

### 目标

让 Pipeline Runner 能够自动执行代码变更，实现"懒人开发"模式：用户只需输入想法，AI 自动完成 plan → implement → execute → test → commit 全流程。

### 核心需求

1. **自动执行代码**: 将 AI 生成的代码实际写入文件
2. **工作目录配置**: 用户可指定项目路径
3. **模型可配置**: 用户可自定义每个阶段使用的模型
4. **自动测试**: 执行后自动运行测试
5. **自动提交**: 测试通过后自动 git commit

### 模型配置策略

**默认配置**（成本优化）:
- `plan`: **opus** - 需要深度思考和架构设计
- `implement`: **dsp** (DeepSeek) - 编码实现
- `execute`: **dsf** (DeepSeek Flash) - 最便宜，只需解析代码块
- `test`: **dsp** (DeepSeek) - 编写测试
- `report`: **dsf** (DeepSeek Flash) - 总结报告

**用户可在配置文件中自定义**

### 文件修改清单

- `src/executor.ts` (新建) - 文件执行器
- `src/pipeline.ts` (修改) - 添加 execute 阶段和工作目录支持
- `src/server/routes/api-run.ts` (修改) - 接收新参数
- `public/index.html` (修改) - 添加工作目录输入和自动提交选项
- `config.example.json` (修改) - 添加 pipeline 模型配置示例

### 详细实施步骤

#### 步骤 O1: 创建文件执行器 `src/executor.ts`

**创建新文件**: `src/executor.ts`

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface ExecuteOptions {
  workingDir: string;
  dryRun?: boolean;
}

export interface ExecuteResult {
  filesWritten: string[];
  errors: string[];
}

/**
 * 从 AI 生成的文本中提取代码块
 * 支持格式：
 * ```typescript:src/file.ts
 * code here
 * ```
 */
function extractCodeBlocks(text: string): Array<{ filename: string; content: string }> {
  const blocks: Array<{ filename: string; content: string }> = [];
  
  // 匹配格式: ```language:filepath
  const regex = /```(?:\w+)?:([^\n]+)\n([\s\S]*?)```/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      filename: match[1].trim(),
      content: match[2]
    });
  }
  
  // 如果没有找到带路径的代码块，尝试匹配 "File: path/to/file" 格式
  if (blocks.length === 0) {
    const fileRegex = /(?:File|文件):\s*([^\n]+)\n```[\w]*\n([\s\S]*?)```/gi;
    while ((match = fileRegex.exec(text)) !== null) {
      blocks.push({
        filename: match[1].trim(),
        content: match[2]
      });
    }
  }
  
  return blocks;
}

/**
 * 验证工作目录是否安全
 */
function validateWorkingDir(dir: string): boolean {
  // 基本安全检查：不允许根目录、系统目录
  const forbidden = ['/', '/usr', '/bin', '/etc', '/var', '/System'];
  if (forbidden.includes(dir)) {
    return false;
  }
  
  // 必须是绝对路径
  if (!path.isAbsolute(dir)) {
    return false;
  }
  
  return true;
}

/**
 * 执行代码变更：解析 AI 生成的代码并写入文件
 */
export async function executeCodeChanges(
  implementText: string,
  options: ExecuteOptions
): Promise<ExecuteResult> {
  const filesWritten: string[] = [];
  const errors: string[] = [];
  
  // 验证工作目录
  if (!validateWorkingDir(options.workingDir)) {
    errors.push(`Invalid working directory: ${options.workingDir}`);
    return { filesWritten, errors };
  }
  
  // 检查目录是否存在
  try {
    await fs.access(options.workingDir);
  } catch {
    errors.push(`Working directory does not exist: ${options.workingDir}`);
    return { filesWritten, errors };
  }
  
  // 解析代码块
  const codeBlocks = extractCodeBlocks(implementText);
  
  if (codeBlocks.length === 0) {
    errors.push('No code blocks found in implementation text');
    return { filesWritten, errors };
  }
  
  // 写入文件
  for (const block of codeBlocks) {
    try {
      const filePath = path.join(options.workingDir, block.filename);
      
      // 安全检查：确保文件路径在工作目录内
      const resolvedPath = path.resolve(filePath);
      const resolvedWorkingDir = path.resolve(options.workingDir);
      if (!resolvedPath.startsWith(resolvedWorkingDir)) {
        errors.push(`Security: ${block.filename} is outside working directory`);
        continue;
      }
      
      if (!options.dryRun) {
        // 确保目录存在
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        // 写入文件
        await fs.writeFile(filePath, block.content, 'utf-8');
      }
      
      filesWritten.push(block.filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${block.filename}: ${message}`);
    }
  }
  
  return { filesWritten, errors };
}

/**
 * 运行测试
 */
export async function runTests(workingDir: string): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync('npm test', { 
      cwd: workingDir,
      timeout: 120000 // 2分钟超时
    });
    return { success: true, output: stdout + stderr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}

/**
 * Git 提交
 */
export async function gitCommit(
  workingDir: string,
  message: string
): Promise<{ success: boolean; output: string }> {
  try {
    // 添加所有变更
    await execAsync('git add .', { cwd: workingDir });
    
    // 检查是否有变更
    const { stdout: status } = await execAsync('git status --porcelain', { cwd: workingDir });
    if (!status.trim()) {
      return { success: true, output: 'No changes to commit' };
    }
    
    // 提交
    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { 
      cwd: workingDir 
    });
    return { success: true, output: stdout };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: message };
  }
}
```

#### 步骤 O2: 修改 `src/pipeline.ts` 添加 execute 阶段

**2.1 更新默认 Pipeline 阶段配置**

**查找**:
```typescript
const DEFAULT_PIPELINE_STAGES: Record<string, { model: string; prompt: string }> = {
  plan: {
    model: 'opus',
```

**在 `report` 阶段之后添加** (保持现有阶段不变，只添加新的):
```typescript
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
```

**2.2 更新 `runPipeline` 函数签名**

**查找**:
```typescript
export async function runPipeline(
  task: string,
  config: Config,
  port: number,
  options?: { timeoutPerStage?: number; signal?: AbortSignal },
): Promise<PipelineResult> {
```

**替换为**:
```typescript
export async function runPipeline(
  task: string,
  config: Config,
  port: number,
  options?: { 
    timeoutPerStage?: number; 
    signal?: AbortSignal;
    workingDir?: string;
    autoCommit?: boolean;
  },
): Promise<PipelineResult> {
```

**2.3 在 runPipeline 函数末尾添加执行逻辑**

**查找** (在函数末尾，return 语句之前):
```typescript
  return { ctx, stages: stageNames, failedStages, timedOutStages, abortedAt: null };
}
```

**替换为**:
```typescript
  // 执行代码变更（如果指定了工作目录）
  if (options?.workingDir && ctx.implement) {
    try {
      const { executeCodeChanges, runTests, gitCommit } = await import('./executor.js');
      
      // 执行代码写入
      const executeResult = await executeCodeChanges(ctx.implement, {
        workingDir: options.workingDir,
        dryRun: false
      });
      
      ctx.executeResult = JSON.stringify(executeResult, null, 2);
      
      if (executeResult.filesWritten.length > 0) {
        process.stderr.write(`[execute] Wrote ${executeResult.filesWritten.length} files\n`);
        
        // 运行测试
        const testResult = await runTests(options.workingDir);
        ctx.testExecution = testResult.output;
        
        if (testResult.success) {
          process.stderr.write('[execute] Tests passed\n');
          
          // 自动提交
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
    }
  }
  
  return { ctx, stages: stageNames, failedStages, timedOutStages, abortedAt: null };
}
```

#### 步骤 O3: 修改 `src/server/routes/api-run.ts`

**查找**:
```typescript
        const { task } = JSON.parse(body) as { task?: string };
        if (!task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task is required' }));
          return;
        }

        const config = getConfig();
        const port = config.port || 3457;
        const jobId = `run-${Date.now()}`;
        jobs.set(jobId, { status: 'running' });

        const result: PipelineResult = await runPipeline(task, config, port);
```

**替换为**:
```typescript
        const { task, workingDir, autoCommit } = JSON.parse(body) as { 
          task?: string;
          workingDir?: string;
          autoCommit?: boolean;
        };
        if (!task) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Task is required' }));
          return;
        }

        const config = getConfig();
        const port = config.port || 3457;
        const jobId = `run-${Date.now()}`;
        jobs.set(jobId, { status: 'running' });

        const result: PipelineResult = await runPipeline(task, config, port, {
          workingDir,
          autoCommit: autoCommit ?? false
        });
```

#### 步骤 O4: 修改 `public/index.html` 添加 UI

**查找**:
```html
  <div class="card full">
    <h2>
      <span data-lang="en">Pipeline Runner</span>
      <span data-lang="zh">流水线运行器</span>
    </h2>
    <textarea id="pipeline-task" class="mb" placeholder="Enter task description..."></textarea>
    <div style="display:flex; gap:8px; align-items:center;">
      <button onclick="runPipeline()">
        <span data-lang="en">Run Pipeline</span>
        <span data-lang="zh">运行流水线</span>
      </button>
      <span id="pipeline-msg"></span>
    </div>
  </div>
```

**替换为**:
```html
  <div class="card full">
    <h2>
      <span data-lang="en">Pipeline Runner</span>
      <span data-lang="zh">流水线运行器</span>
    </h2>
    
    <input 
      id="working-dir" 
      class="mb" 
      placeholder="/path/to/project (optional)"
      style="font-size:12px;"
    >
    
    <textarea 
      id="pipeline-task" 
      class="mb" 
      placeholder="Enter task description..."
    ></textarea>
    
    <div style="display:flex; gap:12px; align-items:center; margin-bottom:8px;">
      <label style="font-size:12px; color:#888; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="checkbox" id="auto-commit" style="width:auto; margin:0;">
        <span data-lang="en">Auto-commit on success</span>
        <span data-lang="zh">成功后自动提交</span>
      </label>
      
      <label style="font-size:12px; color:#888; display:flex; align-items:center; gap:4px; cursor:pointer;">
        <input type="checkbox" id="auto-execute" checked style="width:auto; margin:0;">
        <span data-lang="en">Auto-execute code</span>
        <span data-lang="zh">自动执行代码</span>
      </label>
    </div>
    
    <div style="display:flex; gap:8px; align-items:center;">
      <button onclick="runPipeline()">
        <span data-lang="en">Run Pipeline</span>
        <span data-lang="zh">运行流水线</span>
      </button>
      <span id="pipeline-msg"></span>
    </div>
  </div>
```

**修改 `runPipeline()` JavaScript 函数**:

**查找**:
```javascript
async function runPipeline() {
  var msg = document.getElementById('pipeline-msg');
  var task = document.getElementById('pipeline-task').value.trim();
  if (!task) {
    msg.className='error';
    msg.innerHTML = '<span data-lang="en">Enter a task description</span><span data-lang="zh">输入任务描述</span>';
    return;
  }
  msg.className=''; msg.textContent = 'Running...';
  try {
    var r = await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:task})});
    var d = await r.json();
    msg.className = d.jobId?'success':'error';
    msg.textContent = d.jobId?('Submitted: ' + d.jobId):(d.error||'Failed');
  } catch(e) { msg.className='error'; msg.textContent=e.message; }
}
```

**替换为**:
```javascript
async function runPipeline() {
  var msg = document.getElementById('pipeline-msg');
  var task = document.getElementById('pipeline-task').value.trim();
  var workingDir = document.getElementById('working-dir').value.trim();
  var autoCommit = document.getElementById('auto-commit').checked;
  var autoExecute = document.getElementById('auto-execute').checked;
  
  if (!task) {
    msg.className='error';
    msg.innerHTML = '<span data-lang="en">Enter a task description</span><span data-lang="zh">输入任务描述</span>';
    return;
  }
  
  if (autoExecute && !workingDir) {
    msg.className='error';
    msg.innerHTML = '<span data-lang="en">Working directory required for auto-execute</span><span data-lang="zh">自动执行需要指定工作目录</span>';
    return;
  }
  
  msg.className=''; 
  msg.innerHTML = '<span data-lang="en">Running...</span><span data-lang="zh">运行中...</span>';
  
  try {
    var payload = { task: task };
    if (autoExecute && workingDir) {
      payload.workingDir = workingDir;
      payload.autoCommit = autoCommit;
    }
    
    var r = await fetch('/api/run', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    
    var d = await r.json();
    msg.className = d.jobId ? 'success' : 'error';
    
    if (d.jobId) {
      msg.innerHTML = '<span data-lang="en">Submitted: ' + d.jobId + '</span><span data-lang="zh">已提交: ' + d.jobId + '</span>';
    } else {
      msg.textContent = d.error || 'Failed';
    }
  } catch(e) { 
    msg.className='error'; 
    msg.textContent = e.message; 
  }
}
```

#### 步骤 O5: 更新配置文件示例

**如果存在 `config.example.json`，添加 pipeline 配置示例**:

```json
{
  "port": 3457,
  "aliases": {
    "opus": "claude-opus-4-20250514",
    "sonnet": "claude-sonnet-4-20250514",
    "haiku": "claude-haiku-4-20250313",
    "dsp": "deepseek-chat",
    "dsf": "deepseek-reasoner"
  },
  "pipeline": {
    "plan": {
      "model": "opus",
      "prompt": "..."
    },
    "implement": {
      "model": "dsp",
      "prompt": "..."
    },
    "execute": {
      "model": "dsf",
      "prompt": "..."
    },
    "test": {
      "model": "dsp",
      "prompt": "..."
    },
    "report": {
      "model": "dsf",
      "prompt": "..."
    }
  }
}
```

**注释**: 用户可以通过修改配置文件来自定义每个阶段使用的模型。

#### 步骤 O6: 测试任务 O

**6.1 编译项目**:
```bash
npm run build
```

**6.2 启动服务器**:
```bash
npm start
```

**6.3 测试流程**:

1. 打开浏览器访问 `http://localhost:3000`
2. 在 Pipeline Runner 中：
   - 工作目录输入：`/Users/velen/projects/claude-model-router`
   - 任务描述输入：`创建一个简单的 hello.txt 文件，内容为 "Hello from Pipeline"`
   - 勾选"Auto-execute code"
   - 勾选"Auto-commit on success"
3. 点击"Run Pipeline"
4. 等待完成（约 2-5 分钟）
5. 检查项目目录是否生成了 `hello.txt`
6. 检查 git log 是否有新的提交

**6.4 测试清单**:
- [ ] Pipeline 能够成功运行所有阶段
- [ ] 代码块被正确解析
- [ ] 文件被正确写入到指定目录
- [ ] 测试自动运行
- [ ] 测试通过后自动提交
- [ ] 错误处理正常（如工作目录不存在）
- [ ] UI 显示正确的状态信息
- [ ] 双语文本正确显示

#### 步骤 O7: 提交任务 O

```bash
git add src/executor.ts src/pipeline.ts src/server/routes/api-run.ts public/index.html
git commit -m "feat: add pipeline auto-execution functionality

- Add executor module for code parsing and file writing
- Add execute stage to pipeline with configurable models
- Add workingDir and autoCommit options to pipeline
- Add UI controls for working directory and auto-commit
- Support automatic test execution and git commit
- Allow users to configure models per pipeline stage

Default model configuration:
- plan: opus (deep thinking)
- implement: dsp (DeepSeek)
- execute: dsf (DeepSeek Flash, cheapest)
- test: dsp (DeepSeek)
- report: dsf (DeepSeek Flash)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## 🔍 完整测试清单

### 任务 N 测试
- [ ] 手动刷新按钮正常工作
- [ ] 自动刷新开关正常工作
- [ ] 刷新页面后自动刷新设置保持
- [ ] 最后刷新时间正确显示
- [ ] 日志滚动到底部
- [ ] 网络错误时不会中断自动刷新

### 任务 M 测试
- [ ] 语言切换按钮正常工作
- [ ] 刷新页面后语言设置保持
- [ ] 浏览器语言检测正常（中文浏览器默认显示中文）
- [ ] 所有静态文本都有双语版本
- [ ] 动态生成的文本也正确显示对应语言
- [ ] 样式在两种语言下都正常
- [ ] CHANGELOG.md 双语格式正确

### 任务 O 测试
- [ ] Pipeline 所有阶段正常运行
- [ ] 代码块正确解析和提取
- [ ] 文件正确写入指定目录
- [ ] 路径安全检查生效
- [ ] 测试自动执行
- [ ] 测试通过后自动提交
- [ ] 工作目录验证正常
- [ ] 错误处理和提示清晰
- [ ] UI 控件功能正常
- [ ] 双语文本正确显示

### 集成测试
- [ ] 三个功能同时工作正常
- [ ] 切换语言后，所有新增文本都切换
- [ ] Pipeline 执行时日志实时更新
- [ ] 没有 JavaScript 错误
- [ ] 没有样式冲突
- [ ] 页面性能正常
- [ ] 成本优化生效（使用配置的模型）

---

## ⚠️ 任务 O 特别注意事项

### 安全考虑

1. **工作目录验证**: 
   - 不允许根目录和系统目录
   - 必须是绝对路径
   - 文件路径必须在工作目录内

2. **代码执行风险**:
   - 只写入文件，不执行任意代码
   - npm test 在沙箱环境中运行
   - git 操作仅限于 add 和 commit

3. **错误恢复**:
   - 建议在执行前创建 git branch
   - 保留详细的执行日志
   - 失败时不自动提交

### 成本优化

1. **模型选择**:
   - plan 用 opus（最贵但最重要）
   - 其他阶段用 DeepSeek（便宜）
   - execute 用 dsf（最便宜，只需解析）

2. **用户可配置**:
   - 在 `config.json` 中自定义每个阶段的模型
   - 可以根据任务复杂度调整
   - 支持添加自定义阶段

### 调试建议

1. **查看日志**: 
   - Pipeline 执行日志在 Web UI 的"Recent Logs"中
   - 服务器日志: `stderr` 输出

2. **Dry Run 模式**:
   - 可以在 executor 中设置 `dryRun: true`
   - 只解析不写入，用于测试

3. **分阶段测试**:
   - 先测试不带 workingDir 的 pipeline（只生成文本）
   - 再测试带 workingDir 但不 autoCommit
   - 最后测试完整流程

---

## ✅ 完成标志

当以下所有条件满足时，任务完成：

- [ ] 任务 N 的所有测试通过
- [ ] 任务 M 的所有测试通过
- [ ] 任务 O 的所有测试通过
- [ ] 集成测试通过
- [ ] 代码已提交到 Git
- [ ] 没有明显的 bug 或错误
- [ ] 用户体验良好
- [ ] 成本优化生效

---

## 📊 预期最终成果

### 任务 N 完成后
- ✅ 日志区域有"刷新"按钮
- ✅ 日志区域有"自动刷新"开关
- ✅ 显示最后刷新时间
- ✅ 用户偏好被保存到 localStorage

### 任务 M 完成后
- ✅ WebUI 右上角有语言切换按钮
- ✅ 所有文本支持中英文切换
- ✅ 语言偏好被保存
- ✅ 自动检测浏览器语言
- ✅ CHANGELOG.md 有中文翻译

### 任务 O 完成后
- ✅ Pipeline 可以自动执行代码变更
- ✅ 用户可以指定工作目录
- ✅ 支持自动测试和提交
- ✅ 模型配置可自定义
- ✅ 实现"懒人开发"模式

### 最终效果
- ✅ 用户只需输入想法，AI 自动完成全流程
- ✅ 成本优化（使用便宜的模型）
- ✅ 安全可控（基本的路径验证）
- ✅ 用户体验良好（双语、实时日志）
- ✅ 代码质量良好，无明显 bug

---

**祝 DeepSeek 执行顺利！** 🎉

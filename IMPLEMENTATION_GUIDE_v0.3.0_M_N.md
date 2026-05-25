# v0.3.0 实施指导 — 任务 M & N

## 任务概览

| ID | 任务 | 优先级 | 预估时间 |
|---|---|---|---|
| M | WebUI/Git 文档双语模式 | P2 | 2-3h |
| N | Web 后台日志实时同步/刷新按钮 | P2 | 0.5-1h |

---

## 任务 M：WebUI/Git 文档双语模式

### 目标

为 WebUI 和 Git 文档添加双语切换功能，参考大型开源项目（如 Vue.js、React）的实现方式。

### 技术方案

**方案选择：纯前端实现（推荐）**

- 在 HTML 中使用 `data-lang` 属性标记不同语言的内容
- 通过 CSS 控制显示/隐藏
- 使用 localStorage 保存用户语言偏好
- 页面加载时自动应用保存的语言设置

**替代方案：多文件方案（不推荐）**
- 创建 `index.en.html` 和 `index.zh.html`
- 缺点：维护成本高，需要同步两份文件

### 实现步骤

#### 步骤 1：修改 `public/index.html` 添加双语支持

**1.1 在 `<head>` 中添加语言切换样式**

```css
/* 在现有 <style> 标签中添加 */
.lang-switcher {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
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
[data-lang]:not([data-lang="en"]) { display: none; }
body.lang-zh [data-lang="en"] { display: none; }
body.lang-zh [data-lang="zh"] { display: block; }
body.lang-en [data-lang="zh"] { display: none; }
body.lang-en [data-lang="en"] { display: block; }
```

**1.2 在 `<body>` 开头添加语言切换按钮**

```html
<div class="lang-switcher">
  <button class="lang-btn" data-lang-btn="en" onclick="switchLang('en')">English</button>
  <button class="lang-btn" data-lang-btn="zh" onclick="switchLang('zh')">中文</button>
</div>
```

**1.3 将现有文本内容改为双语标记**

示例（标题部分）：

```html
<!-- 原来 -->
<h1>Claude Model Router</h1>
<p class="subtitle" id="status-line">Connecting...</p>

<!-- 改为 -->
<h1>
  <span data-lang="en">Claude Model Router</span>
  <span data-lang="zh">Claude 模型路由器</span>
</h1>
<p class="subtitle" id="status-line">
  <span data-lang="en">Connecting...</span>
  <span data-lang="zh">连接中...</span>
</p>
```

**需要双语化的所有文本：**

| 英文 | 中文 |
|---|---|
| Claude Model Router | Claude 模型路由器 |
| Connecting... | 连接中... |
| Connected | 已连接 |
| Status | 状态 |
| Total Requests | 总请求数 |
| Uptime | 运行时长 |
| Started | 启动时间 |
| HTTP Port | HTTP 端口 |
| Backend Health | 后端健康状态 |
| Backend | 后端 |
| Status | 状态 |
| Requests | 请求数 |
| Last | 最后请求 |
| No data | 无数据 |
| No backends configured | 未配置后端 |
| Configuration | 配置 |
| Refresh | 刷新 |
| Save | 保存 |
| Saved! | 已保存！ |
| Failed to load config | 加载配置失败 |
| Pipeline Runner | 流水线运行器 |
| Enter task description... | 输入任务描述... |
| Run Pipeline | 运行流水线 |
| Running... | 运行中... |
| Submitted | 已提交 |
| Failed | 失败 |
| Recent Logs | 最近日志 |
| Loading... | 加载中... |
| (no logs) | （无日志） |
| Refresh Logs | 刷新日志 |
| Auto-refresh | 自动刷新 |

**1.4 在 `<script>` 标签末尾添加语言切换逻辑**

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

#### 步骤 2：更新 `README.md` 双语格式（可选）

当前 README.md 已经有双语内容，但格式是混合的。可以考虑：

**选项 A：保持现状**（推荐）
- README.md 保持当前的混合双语格式
- 只在 WebUI 中实现切换

**选项 B：创建独立的中文 README**
- 创建 `README.zh-CN.md`
- 在 `README.md` 顶部添加语言切换链接：
  ```markdown
  [English](./README.md) | [简体中文](./README.zh-CN.md)
  ```

#### 步骤 3：更新 `CHANGELOG.md` 添加中文翻译

**选项 A：单文件双语**（推荐）

```markdown
# Changelog

[English](#english) | [中文](#中文)

---

## English

### [0.3.0] - 2026-05-XX

#### Added
- Web UI authentication middleware
- ...

---

## 中文

### [0.3.0] - 2026-05-XX

#### 新增
- Web UI 认证中间件
- ...
```

**选项 B：独立文件**

创建 `CHANGELOG.zh-CN.md`，在 `CHANGELOG.md` 顶部添加链接。

### 测试要点

1. **语言切换功能**
   - 点击 English/中文按钮，页面内容应立即切换
   - 刷新页面后，语言设置应保持
   - 清除 localStorage 后，应根据浏览器语言自动选择

2. **样式检查**
   - 语言按钮在不同屏幕尺寸下位置正确
   - 活动语言按钮高亮显示
   - 中文文本不会导致布局错乱

3. **内容完整性**
   - 所有可见文本都有对应的双语版本
   - 动态生成的内容（如状态信息）也正确显示对应语言

### 注意事项

1. **保持 HTML 文件大小合理**：双语内容会增加文件大小，但由于是静态文本，影响不大
2. **避免硬编码**：动态生成的文本（如错误消息）需要在 JavaScript 中定义双语映射
3. **可访问性**：确保语言切换按钮有适当的 `aria-label`
4. **SEO**：如果未来需要 SEO，考虑使用 `<html lang="en">` 和动态更新

---

## 任务 N：Web 后台日志实时同步/刷新按钮

### 目标

为 Web 后台的日志区域添加手动刷新按钮，并优化自动刷新逻辑。

### 技术方案

**核心功能：**
1. 添加"刷新日志"按钮
2. 添加"自动刷新"开关
3. 将日志刷新逻辑从全局 `setInterval` 中分离
4. 保存用户的自动刷新偏好

**可选增强：**
- 添加日志级别过滤（info/warn/error）
- 添加日志搜索功能
- 显示最后刷新时间

### 实现步骤

#### 步骤 1：修改 `public/index.html` 日志卡片

**1.1 更新日志卡片 HTML 结构**

```html
<!-- 原来 -->
<div class="card full">
  <h2>Recent Logs</h2>
  <div id="log-container">Loading...</div>
</div>

<!-- 改为 -->
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

**1.2 更新 JavaScript 逻辑**

```javascript
// 在现有 <script> 标签中修改和添加

let autoRefreshEnabled = true;
let logRefreshInterval = null;

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

// 修改页面底部的初始化代码
// 原来：
// setInterval(()=>{refreshStats();refreshLogs();}, 2000);
// refreshStats(); refreshLogs();

// 改为：
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

#### 步骤 2：可选增强功能

**2.1 添加日志级别过滤**

```html
<!-- 在日志卡片标题栏添加过滤器 -->
<select id="log-level-filter" onchange="filterLogs()" style="font-size:12px; padding:4px;">
  <option value="all">All Levels</option>
  <option value="info">Info</option>
  <option value="warn">Warn</option>
  <option value="error">Error</option>
</select>
```

```javascript
function filterLogs() {
  const level = document.getElementById('log-level-filter').value;
  const container = document.getElementById('log-container');
  const logs = container.querySelectorAll('div');
  
  logs.forEach(log => {
    if (level === 'all') {
      log.style.display = 'block';
    } else {
      const text = log.textContent.toLowerCase();
      log.style.display = text.includes(level) ? 'block' : 'none';
    }
  });
}
```

**2.2 添加日志搜索**

```html
<input type="text" id="log-search" placeholder="Search logs..." 
       oninput="searchLogs()" style="font-size:12px; padding:4px; width:150px;">
```

```javascript
function searchLogs() {
  const query = document.getElementById('log-search').value.toLowerCase();
  const container = document.getElementById('log-container');
  const logs = container.querySelectorAll('div');
  
  logs.forEach(log => {
    const text = log.textContent.toLowerCase();
    log.style.display = text.includes(query) ? 'block' : 'none';
  });
}
```

### 测试要点

1. **手动刷新**
   - 点击"刷新"按钮，日志应立即更新
   - 最后刷新时间应显示当前时间

2. **自动刷新开关**
   - 取消勾选"自动刷新"，日志应停止自动更新
   - 重新勾选，日志应恢复自动更新
   - 刷新页面后，设置应保持

3. **性能**
   - 自动刷新不应影响页面其他功能
   - 日志容器应正确滚动到底部

4. **双语支持**
   - 所有新增文本都有中英文版本
   - 语言切换时，日志区域的文本也应切换

### 注意事项

1. **避免重复请求**：确保手动刷新和自动刷新不会同时触发
2. **错误处理**：网络错误时不应中断自动刷新
3. **内存泄漏**：确保 `setInterval` 在页面卸载时被清除（虽然单页应用不太需要）
4. **用户体验**：刷新时不应清空现有日志（避免闪烁）

---

## 实施顺序建议

1. **先实施任务 N**（0.5-1h）
   - 功能简单，风险低
   - 可以快速验证效果
   - 为任务 M 的双语支持做准备

2. **再实施任务 M**（2-3h）
   - 需要修改大量文本
   - 需要仔细测试语言切换
   - 可以复用任务 N 中的双语标记

---

## 测试清单

### 任务 M 测试

- [ ] 语言切换按钮正常工作
- [ ] 刷新页面后语言设置保持
- [ ] 浏览器语言检测正常（中文浏览器默认显示中文）
- [ ] 所有静态文本都有双语版本
- [ ] 动态生成的文本（状态、错误消息）也正确显示对应语言
- [ ] 样式在两种语言下都正常
- [ ] README.md 和 CHANGELOG.md 双语格式正确

### 任务 N 测试

- [ ] 手动刷新按钮正常工作
- [ ] 自动刷新开关正常工作
- [ ] 刷新页面后自动刷新设置保持
- [ ] 最后刷新时间正确显示
- [ ] 日志滚动到底部
- [ ] 网络错误时不会中断自动刷新
- [ ] 双语文本正确显示

---

## 提交规范

### 任务 M 提交信息

```
feat: add bilingual support to WebUI and docs

- Add language switcher (EN/ZH) to WebUI
- Implement localStorage-based language preference
- Auto-detect browser language on first visit
- Update README.md with bilingual format
- Add Chinese translation to CHANGELOG.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

### 任务 N 提交信息

```
feat: add manual refresh and auto-refresh toggle for logs

- Add "Refresh Logs" button to logs card
- Add "Auto-refresh" checkbox with localStorage persistence
- Display last refresh timestamp
- Separate log refresh logic from stats refresh
- Support bilingual UI (EN/ZH)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## 预期成果

### 任务 M

- WebUI 支持中英文切换
- 用户语言偏好被保存
- 文档（README/CHANGELOG）有清晰的双语版本

### 任务 N

- 日志可以手动刷新
- 自动刷新可以开关
- 用户体验更好（不需要刷新整个页面）

---

## 风险评估

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 双语内容增加 HTML 文件大小 | 低 | 文件仍然很小（<20KB），可接受 |
| 语言切换逻辑有 bug | 中 | 充分测试，使用简单的 CSS 类切换 |
| 自动刷新影响性能 | 低 | 2 秒间隔合理，可配置 |
| localStorage 不可用 | 低 | 降级到默认语言，不影响核心功能 |

---

## 后续优化建议

1. **任务 M 后续**
   - 考虑添加更多语言（日语、韩语等）
   - 使用 i18n 库（如果内容继续增长）
   - 为 Git 文档添加自动翻译工具

2. **任务 N 后续**
   - 添加日志导出功能
   - 添加日志级别过滤
   - 添加日志搜索功能
   - 支持 WebSocket 实时推送日志

---

## 参考资料

### 双语实现参考

- Vue.js 官网：https://vuejs.org/
- React 官网：https://react.dev/
- MDN Web Docs：https://developer.mozilla.org/

### 技术文档

- localStorage API：https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
- CSS 属性选择器：https://developer.mozilla.org/en-US/docs/Web/CSS/Attribute_selectors
- Navigator.language：https://developer.mozilla.org/en-US/docs/Web/API/Navigator/language

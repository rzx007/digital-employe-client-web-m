# 阶段 4：Skill 化 + 文档化 — 实施文档

> 预计工期：0.5 周 | 依赖：阶段 3 完成 | 状态：待开始

## 目标

把能力以"浏览器操作 skill"形式暴露给总管/员工；写完整架构 + 开发者文档。

---

## 实施步骤

### Step 4.1 — 浏览器操作助手 Skill

**新建文件：** `apps/server/build-in-skills/browser-automation/SKILL.md`

```markdown
---
name: browser-automation
description: 内嵌浏览器自动化操作助手，可打开网页、点击元素、填写表单、提取文本
---

# 浏览器操作助手

## 适用场景
- 三方业务系统无 OpenAPI，但需在对话中辅助操作
- 用户在内嵌浏览器中已登录，agent 可"代为点击"
- 需要跨多步表单操作（如登录、申请、查询）
- 需要获取网页内容并分析（如读取页面信息）

## 可用工具

| 工具 | 用途 | 典型用法 |
|------|------|----------|
| `browser_navigate` | 导航到 URL | 打开目标页面 |
| `browser_snapshot` | 获取 a11y 树 | 了解页面结构，发现可操作元素 |
| `browser_click` | 点击元素 | 点击按钮、链接 |
| `browser_fill` | 填写文本 | 填写输入框、文本域 |
| `browser_extract_text` | 提取纯文本 | 读取页面内容 |
| `browser_screenshot` | 截图 | 可视化确认当前页面状态 |
| `browser_get_url` | 获取当前 URL | 确认导航结果 |

## 最佳实践

1. **先 snapshot 再操作**：每次操作前先用 `browser_snapshot` 获取最新页面结构和 `@eN` 引用
2. **优先用 CSS selector**：如果有技能提供 `automation.operations` 中的 selector，优先使用，更稳定
3. **selector 失效时回退**：`ELEMENT_NOT_FOUND` → 重新 `browser_snapshot` 获取最新结构
4. **页面加载后等一等**：navigate 后建议先 snapshot 确认页面已加载
5. **分步操作**：复杂表单拆成多步，每步确认结果

## 安全规范

- 不向用户索要密码，由用户在内嵌浏览器中手动登录
- 密码字段在 snapshot 中自动脱敏
- 有副作用的操作（提交、删除等）会弹出确认框
- 所有操作记录审计日志

## 错误恢复

| 错误 | 处理方式 |
|------|----------|
| `BROWSER_UNAVAILABLE` | 提示用户先打开浏览器面板（点 Globe 按钮） |
| `ELEMENT_NOT_FOUND` | 重新 `browser_snapshot`，用新的 @eN 引用 |
| `STALE_REF` | 页面已变化，重新 `browser_snapshot` |
| `TIMEOUT` | 页面加载慢，建议重试 |
| `USER_CANCELLED` | 用户取消了确认框，告知用户操作已取消 |

## 操作示例

### 示例 1：打开网页并列出链接

```
用户："打开 example.com 列出所有链接"

1. browser_navigate(url="https://example.com")
2. browser_snapshot()
3. 解析 snapshot 中的 role=link 元素
4. 自然语言回复链接列表
```

### 示例 2：在百度搜索

```
用户："帮我搜索周杰伦"

1. browser_navigate(url="https://baidu.com")
2. browser_snapshot()
3. 找到搜索框（role=textbox）
4. browser_fill(ref_or_selector="#kw", text="周杰伦")
5. browser_click(ref_or_selector="#su")
6. 自然语言回复搜索结果
```

### 示例 3：填写多步表单

```
用户："帮我提个加班申请，今天9-19点"

1. browser_navigate(url="https://oa.example.com/overtime/new")
2. browser_snapshot() → 确认表单已加载
3. browser_fill(ref_or_selector="#startTime", text="09:00")
4. browser_fill(ref_or_selector="#endTime", text="19:00")
5. browser_fill(ref_or_selector="#reason", text="工作需要")
6. browser_click(ref_or_selector="#submit", confirmation_required=True)
7. 等待用户确认
8. 自然语言回复提交结果
```
```

### Step 4.2 — 架构文档

**新建文件：** `apps/server/docs/browser-architecture.md`

```markdown
# 内嵌浏览器自动化 — 架构文档

## 概述

数字员工客户端内嵌三方业务系统浏览器面板，支持用户手动浏览和 agent 自动化操作。

## 架构图

```
┌─── React 主窗口 ───────────────────────────────────────────────────┐
│                                                                     │
│  ChatLayout 右抽屉                                                  │
│  ├─ BrowserPanel (React)                                           │
│  │    URL bar + 状态栏 + confirmation 模态框                        │
│  └─ BrowserWidthSlider (30%-80%)                                   │
│       │ contextBridge: { open, navigate, resize }                  │
│       ▼                                                             │
│  Electron 主进程                                                    │
│  ├─ BrowserWindowController                                        │
│  │    └─ BrowserWindow(parent: main, session: partition)            │
│  ├─ BrowserDebuggerController (webContents.debugger, CDP)           │
│  ├─ BrowserSessionStore (session_id → partition)                   │
│  ├─ UrlAllowlist (browser-allowlist.json)                          │
│  └─ AuditLog (browser-audit.json)                                  │
│       │ HTTP 127.0.0.1:58000                                        │
│       ▼                                                             │
│  FastAPI /internal/browser/{session_id}/*                          │
│  BrowserRuntimeClient → @tool × 7                                   │
│       ▼                                                             │
│  deepagents Agent                                                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 4 层 IPC 架构

```
Layer 1 — shared/ipc-channels.ts     IpcChannels + IpcInvokeMap
Layer 2 — features/browser/ipc.ts    IpcContribution { register(ctx) → handlers[] }
Layer 3 — core/ipc/registry.ts       IpcRegistry 遍历 allIpcContributions
Layer 4 — features/browser/preload-bridge.ts   invoke() + onChannel()
```

## 7 个 CDP 原子操作

| 操作 | CDP 协议 | 输入 | 输出 |
|------|----------|------|------|
| navigate | Page.navigate + loadEventFired | url | { url, title } |
| snapshot | Accessibility.getFullAXTree | maxNodes | { refs: RefNode[] } |
| click | Input.dispatchMouseEvent | refOrSelector | ok |
| fill | click + Input.dispatchKeyEvent × char | refOrSelector, text | ok |
| extract_text | Runtime.evaluate(body.innerText) | — | { text } |
| screenshot | Page.captureScreenshot | — | { base64 } |
| get_url | Runtime.evaluate(location.href) | — | { url } |

## @eN Ref 编号算法

```typescript
// 深度优先遍历 AX 树，跳过 hidden/none/generic(无name,depth>2)
// maxNodes=200 截断
// 密码字段 mask: role=password → value="[REDACTED]"
```

## Session 隔离

- 每个 conversation 用独立 partition: `persist:browser-panel-{sessionId}`
- Cookie/localStorage 完全隔离
- 用户首次需手动登录，后续自动保持

## 安全护栏

| 护栏 | 实现 |
|------|------|
| 密码字段 mask | snapshot 中 role=password → value="[REDACTED]" |
| 工具调用 timeout | asyncio.wait_for(30s) |
| URL 白名单 | browser-allowlist.json, 默认 ["*"] |
| 全量审计 | browser_audit_log 表 |
| 操作可见性 | 前端 3s 黄色高亮环 |
| devTools 互斥 | 开自动化即关 devTools |
| HITL 确认 | confirmation_required=True 弹模态框 |

## 技能自动化格式

SKILL.md frontmatter 的 `automation.operations` 字段提供 selector 加速：

```yaml
automation:
  target_url: https://...
  operations:
    - action: navigate | fill | click | select | wait_for | screenshot
      selector: "#..."
      value: "${var}"
      confirmation_required: true/false
```

LLM 仍是每步决策者，技能只提供 selector 兜底。

## 关键文件索引

| 文件 | 职责 |
|------|------|
| `electron/features/browser/browser-window-controller.ts` | 子窗口生命周期 |
| `electron/features/browser/browser-debugger-controller.ts` | CDP 7 原子操作 |
| `electron/features/browser/browser-session-store.ts` | session 隔离 |
| `electron/features/browser/url-allowlist.ts` | URL 白名单 |
| `electron/features/browser/audit-log.ts` | 审计日志 |
| `electron/features/browser/ipc.ts` | IPC handler |
| `electron/features/browser/preload-bridge.ts` | 渲染进程桥 |
| `src/stores/browser-store.ts` | Zustand store |
| `src/components/browser/browser-panel.tsx` | 面板 UI |
| `src/service/browser/browser_runtime_client.py` | HTTP 客户端 |
| `src/service/browser/http_routes.py` | FastAPI 路由 |
| `src/service/browser/audit_log.py` | 审计表 |
| `src/service/agent/browser_tool.py` | 7 个 @tool |

## 扩展指南

### 添加新的浏览器操作工具

1. 在 `browser-debugger-controller.ts` 添加 CDP 方法
2. 在 `ipc-channels.ts` 注册新 channel
3. 在 `ipc.ts` 添加 handler
4. 在 `browser_tool.py` 添加 @tool
5. 更新本架构文档

### 添加新的自动化技能

1. 创建 `build-in-skills/<name>/SKILL.md`
2. 在 frontmatter 添加 `automation.operations`
3. 用 `${var}` 标记模板变量
4. 在 Markdown body 添加 LLM 行为提示
```

### Step 4.3 — AGENTS.md 文档增补

**修改文件：** `apps/server/src/service/agent/AGENTS.md`

在现有文档中增加"浏览器操作"章节：

```markdown
## 浏览器操作

数字员工支持通过 `browser_*` 系列工具在内嵌浏览器中自动化操作三方系统。

### 可用工具

- `browser_navigate(url, intent)` — 导航到 URL
- `browser_click(ref_or_selector, intent, confirmation_required)` — 点击元素
- `browser_fill(ref_or_selector, text, intent)` — 填写文本
- `browser_snapshot(intent)` — 获取 a11y 树（@eN 引用）
- `browser_extract_text(intent)` — 提取页面纯文本
- `browser_screenshot(intent)` — 截图
- `browser_get_url()` — 获取当前 URL

### 使用流程

1. 用户请求操作三方系统
2. `browser_navigate` 打开目标页面
3. `browser_snapshot` 获取页面结构
4. 根据 snapshot 中的 @eN 引用或 CSS selector 执行 click/fill
5. 如果有技能的 `automation.operations`，优先使用其中的 selector

### 安全

- 不向用户索要密码
- 所有操作记录审计日志
- 敏感操作（提交/删除）需用户确认
```

### Step 4.4 — Electron README 增补

**修改文件：** `apps/web/electron/README.md`

增加"内嵌浏览器"章节：

```markdown
## 内嵌浏览器

### 概述

主窗口右侧可拖拽的浏览器面板，承载三方系统页面。支持用户手动浏览和 agent CDP 自动化。

### 目录结构

```
features/browser/
  ├── browser-window-controller.ts    # 子窗口生命周期
  ├── browser-debugger-controller.ts  # CDP 封装（7 原子操作）
  ├── browser-session-store.ts        # session 隔离
  ├── url-allowlist.ts                # URL 白名单
  ├── audit-log.ts                    # 审计日志
  ├── browser-highlight.ts            # 前端高亮环
  ├── ipc.ts                          # IpcContribution
  └── preload-bridge.ts               # contextBridge API
```

### 开发

- 开 devTools 时禁用 CDP 自动化（互斥）
- Session partition: `persist:browser-panel-{sessionId}`
- 审计日志: `~/.digital-employee/logs/browser-audit.json`
- 白名单配置: `~/.digital-employee/configs/browser-allowlist.json`
```

---

## 新增/修改文件清单

### 新增 2 个

| # | 路径 | 职责 |
|---|------|------|
| 1 | `apps/server/build-in-skills/browser-automation/SKILL.md` | 浏览器操作助手 Skill |
| 2 | `apps/server/docs/browser-architecture.md` | 架构文档 |

### 修改 3 个

| # | 路径 | 改动 |
|---|------|------|
| 1 | `apps/server/src/service/agent/AGENTS.md` | 增加浏览器操作章节 |
| 2 | `apps/web/electron/README.md` | 增加内嵌浏览器章节 |
| 3 | `apps/server/src/service/employee_service.py` | 默认员工清单加"浏览器操作助手" |

---

## 验收标准

- [ ] 默认安装内置员工"浏览器操作助手"
- [ ] 在技能市场可见、可绑定
- [ ] 阅读开发者文档 10 分钟内可完成"打开百度 → 搜索"端到端 demo

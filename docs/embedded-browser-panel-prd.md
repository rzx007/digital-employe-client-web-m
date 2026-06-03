# 内嵌三方业务系统浏览器面板 PRD

> 版本：v1.2 | 日期：2026-06-01 | 原始状态：待评审

---

> ## ⚠️ 实现现状（2026-06，权威说明）
>
> **本 PRD 的原始方案（Python `browser_*` 7×@tool + FastAPI `/internal/browser/*` + `BrowserRuntimeClient`）未被采用。** 实际落地架构为：
>
> - **`browser-runtime` 基础 Skill**（`apps/server/build-in-skills/browser-runtime/`）：教 Agent 浏览器工作流
> - **`packages/browserctl`**：零依赖 Node CLI 客户端（私有包，经 electron-builder extraResources 随安装包附带，用 Electron 自带 node 运行）
> - **Electron HTTP bridge** `127.0.0.1:34555`（TypeScript `browser-http-bridge.ts`），复用 Electron 自带 Chromium + CDP
> - Agent 经 `shell_execute` 调用 `browserctl`，**已无 Python `browser_*` @tool / `BrowserRuntimeClient` / FastAPI browser 路由**
>
> **权威文档**：[browser-runtime SKILL](../apps/server/build-in-skills/browser-runtime/SKILL.md) · [reference](../apps/server/build-in-skills/browser-runtime/reference.md) · [browserctl README](../packages/browserctl/README.md) · [roadmap](./browser-runtime-roadmap.md)
>
> **过时章节（仅作设计背景历史记录）**：2.1–2.6（架构图 / IPC / @tool 清单 / 数据流的 Python 部分）、3.x（实施阶段）、4（文件改动总览）、5（依赖打包）、7.1（Python 测试脚本）、9.1（代码位置）。
> **仍大体有效**：1（问题陈述 / 痛点 / 目标）、2.7（HITL 与安全护栏）、6（风险与缓解）。

## 1. 问题陈述

### 1.1 现状

当前数字员工客户端与三方业务系统的对接**仅走 HTTP API 通道**：

| 系统 | 对接方式 | 限制 |
|------|----------|------|
| 飞书 (Lark) | `feishu_*_service.py` + `lark-cli` + OpenAPI | 仅官方 OpenAPI 能力，BPM 表单 / 视频会议控件 / 部分管理后台无 API |
| 内部 ERP / 管控平台 | `http://192.168.2.78:5002` 远程网关转发 | 接口不开放的能力（如自定义工作流、报表设计器）无法触达 |
| 内部 AI 调度系统 | `mcp_service.py` + `REMOTE_API_BASE_URL` | 仅"AI调度员/jianceyuan/muxianshidian"等登记过的 MCP 工具 |
| 通用三方系统 | ❌ 无 | 完全没有对接能力 |

用户**唯一可选**的三方系统访问路径是 Electron 主进程 `apps/web/electron/main/index.ts:140-143`：

```typescript
win.webContents.setWindowOpenHandler(({ url }) => {
  if (url.startsWith("https:")) shell.openExternal(url)
  return { action: "deny" }
})
```

所有 `https://...` 链接被 **弹出系统默认浏览器** 打开，业务操作完全脱离数字员工客户端。

### 1.2 痛点

| # | 痛点 | 业务影响 |
|---|------|----------|
| 1 | **三方业务系统只能在系统浏览器中操作** | 用户必须跳出客户端；agent 无法辅助；登录态、上下文割裂 |
| 2 | **没有"agent 接管浏览器"能力** | 即便三方系统提供 OpenAPI，部分操作（点击按钮、填表、上传文件）仍只能人工完成 |
| 3 | **登录态碎片化** | 主应用 → 飞书 → 内部 ERP → 各种后台，每个都要单独登录 |
| 4 | **agent 与三方页面零交互** | 现有 26 个 `@tool`（员工 5 + 总管 21）全部为后端逻辑，无任何 browser_* 工具 |
| 5 | **三方页面无法被 artifact 化引用** | 现有 `ArtifactPanel` 仅展示 agent 生成的 HTML，无法直接展示 / 操作任意 URL |

### 1.3 机会

参考业内 [agent-browser](https://github.com/vercel-labs/agent-browser)（Rust 写的 CLI，CDP + a11y tree + `@eN` 元素引用）已验证范式可行：

- 浏览器自动化不必引入额外 Chromium 进程（**复用 Electron 41 自带 Chromium**）
- a11y tree + `ref` 引用是 agent 操作 DOM 的成熟范式（远胜"截屏 OCR"）
- 持久 partition 让登录态零成本保留
- 与 deepagents 现有 `@tool` 范式无缝对接

### 1.4 目标

**核心目标**：用户自然语言提问（"帮我打开百度搜索周杰伦"）时，三方页面**在应用内 webContents 中打开**（而非 `shell.openExternal` 弹到系统浏览器）。LLM 通过现有 7 个 `browser_*` 工具驱动页面（navigate / click / fill / snapshot…）。

**次要目标**：技能通过 SKILL.md frontmatter 中的 `automation.operations` 字段提供**硬编码 selector**，让 LLM 在已知系统上**不用每次都做 a11y 推理**，从而降低错误率、加速响应。**技能不替换 LLM 决策**——LLM 仍是每步决策者，技能只是 selector 加速器。

整体目标：

1. **统一操作入口**：三方系统页面在主窗口内打开，与聊天、监控、artifact 面板并排
2. **手动 + agent 双模**：用户可手动浏览；agent 可调用 `browser_*` 工具接管
3. **离线模式兼容**：复用 Electron 自带 Chromium，不下载额外二进制，安装包大小 0 增加
4. **可审计 / 可扩展**：操作全量记录到审计日志，URL 白名单留口但默认全开

### 1.5 非目标（Out of Scope）

- ❌ **不**做录制回放（用户先操作一遍、agent 重放）
- ❌ **不**做"截图 OCR"式 element 识别（用 a11y tree）
- ❌ **不**做三方系统 token 注入（用户已确认"三方系统独立登录"）
- ❌ **不**引入 agent-browser CLI、playwright、puppeteer（依赖外部 Chromium 下载）
- ❌ **不**在 MVP 阶段支持多浏览器 tab（单 tab 起步，多 tab 留 Phase 2+）
- ❌ **不**做登录自动化（依赖 Electron session partition 持久化 Cookie，用户首次手动登录即可）

---

## 2. 架构设计

### 2.1 整体架构对比

> ⚠️ **已变更**：下方"改造后"架构图（FastAPI `/internal/browser/*` + `BrowserRuntimeClient` + `@tool×7`）为**未采用的原方案**。实际为 `browser-runtime` Skill + `browserctl` CLI + Electron HTTP bridge（见顶部导读）。

```
  ┌──── 改造前 ───────────────────────────────────────────────────────┐
  │                                                                  │
  │  用户点三方系统链接                                                │
  │       │                                                          │
  │       ▼                                                          │
  │  Electron setWindowOpenHandler                                  │
  │       │                                                          │
  │       ▼                                                          │
  │  shell.openExternal(url)  ──→  系统默认浏览器打开                  │
  │                                                                  │
  │  后果：用户跳出客户端、登录态割裂、agent 无法参与                    │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘

  ┌──── 改造后 ───────────────────────────────────────────────────────┐
  │                                                                  │
  │  React (主窗口)                                                   │
  │  ChatLayout 右抽屉 → BrowserPanel (React)                        │
  │    │ contextBridge: { open, navigate, ... }                      │
  │    ▼                                                             │
  │  Electron 主进程                                                  │
  │  ├─ BrowserWindowManager (parent: main)                          │
  │  │    └─ BrowserWindow { webPreferences.session:                 │
  │  │                          "persist:browser-panel" }            │
  │  └─ BrowserDebuggerController (webContents.debugger, CDP)         │
  │       │ HTTP 127.0.0.1:34555 (aiohttp, 复用后端进程)              │
  │       ▼                                                          │
  │  FastAPI 路由 /internal/browser/*                                │
  │  BrowserRuntimeClient → @tool × 7                                 │
  │       ▼                                                          │
  │  Digital Employee (deepagents 0.6.7)                             │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

### 2.2 关键技术决策

| 决策 | 选型 | 理由 |
|------|------|------|
| **承载容器** | `BrowserWindow(parent: mainWindow)` | 复用 `window-manager.ts:86-138` 工厂；与现有 pet/settings/login 窗口同模式 |
| **Chromium 来源** | Electron 41 自带 Chromium | 不下载额外二进制；包体 0 增加；离线模式天然兼容 |
| **CDP 客户端** | `webContents.debugger` | Electron 内置；零依赖；与 devTools 互斥可控 |
| **a11y 抽取** | CDP `Accessibility.getFullAXTree` + 深度优先 ref 编号 | agent-browser 同款范式；token 友好；可靠 |
| **进程间通信** | FastAPI `POST /internal/browser/*` | 复用 58000 端口；不启新进程；跨平台；易测试 |
| **登录态隔离** | Electron `session.fromPartition("persist:browser-panel")` | 持久化 Cookie；用户登录一次长期有效 |
| **URL 白名单** | 配置文件 + 审计日志 | 默认 `"allow": ["*"]` + `audit: true`；运维按需收紧 |
| **手动 ↔ agent 协作** | 高亮环 + 操作事件 IPC | agent 操作时前端显示 3s 黄色边框环，避免用户与 agent 抢焦点 |
| **技能格式** | 合并到 SKILL.md 顶部 YAML frontmatter 的 `automation.operations` 字段 | 与现有 8 个内置技能（feishu-workbench / lark-base 等）的 frontmatter 风格一致；**不再单独 `automation.yaml` 文件**；不引入 flow executor |

### 2.3 数据流

#### 2.3.1 手动浏览（用户视角）

```
用户点 Globe 按钮
  → browser-store.openBrowser(url)
  → IPC: browser:open({ url, bounds })
  → BrowserWindowController.open(parent, url, bounds)
  → win.loadURL(url)
  → webContents.on('did-finish-load') → IPC: browser:url-change
  → BrowserPanel 显示新 URL / 标题 / loading=false
```

#### 2.3.2 Agent 自动化（两条 first-class 路径）

PRD 设计**两条平行路径**，用户视角都是自然语言，LLM 按场景自动选：

**路径 A — 技能加速路径**（有现成 skill 时）：

```
员工对话 "帮我提个加班申请，今天9-19点"
  → LLM 读 oa-overtime 技能 SKILL.md frontmatter 的 automation.operations
  → 看到 operations 列表 + ${} 模板变量：
      navigate(overtime/new) → fill(#startTime, ${start_time})
      → fill(#endTime, ${end_time}) → ... → click(#submit, confirmation_required=true)
  → LLM 从用户提问提取变量：{ start_time: "09:00", end_time: "19:00", reason: "工作需要" }
  → LLM 依次调 browser_navigate / browser_fill / browser_click（每条独立工具调用）
  → 遇到 confirmation_required: true → 工具层弹确认框 → 用户确认 → 继续
  → 返回结果给 LLM → 自然语言回复
```

**路径 B — 自然语言探索路径**（无 skill / 未知系统时）：

```
员工对话 "把百度首页所有链接列出来"
  → 无对应 skill → LLM 调 browser_navigate("https://baidu.com")
  → @tool 调 FastAPI POST /internal/browser/default/navigate
  → BrowserRuntimeClient → HTTP 127.0.0.1:34555
  → BrowserDebuggerController.navigate(url)
  → webContents.debugger.sendCommand("Page.navigate", { url })
  → 等 Page.loadEventFired
  → LLM 调 browser_snapshot()
  → Accessibility.getFullAXTree → 展平为 @eN refs → 返回 JSON
  → LLM 据 ref 解析链接，生成自然语言回复
```

#### 2.3.3 手动 ↔ Agent 协作

```
agent 调 browser_click(@e5)
  → BrowserDebuggerController.click
  → 获取 @e5 的 backendNodeId + bounding box
  → IPC: browser:event({ action: "click", ref: "@e5", bbox })
  → BrowserPanel 渲染 3s 黄色高亮环
  → Input.dispatchMouseEvent 真实点击
  → CDP 返回 click 成功
```

### 2.4 模块划分

```
apps/web/electron/features/browser/
  ├── browser-window-controller.ts       # 子窗口生命周期 + 位置同步
  ├── browser-debugger-controller.ts     # CDP 封装（7 个原子操作）
  ├── browser-session-store.ts           # session_id → partition 映射
  ├── url-allowlist.ts                   # 域名白名单
  ├── audit-log.ts                       # 操作审计
  ├── browser-highlight.ts               # 前端高亮环逻辑
  └── preload-bridge.ts                  # contextBridge API

apps/web/src/
  ├── stores/browser-store.ts            # zustand: isOpen, currentUrl, ...
  ├── components/chat/right-panels/
  │   ├── browser-panel.tsx              # 抽屉 UI（URL bar + 占位 + 状态栏）
  │   └── browser-width-slider.tsx       # 30%–80% 宽度拖拽
  └── components/settings/
      └── browser-settings-section.tsx   # 设置页：审计日志 + 清理

apps/server/src/service/
  ├── browser/
  │   ├── browser_runtime_client.py      # 调 127.0.0.1:34555
  │   ├── audit_log.py                   # SQLite 审计表
  │   └── http_routes.py                 # FastAPI 路由
  └── agent/tools/browser.py             # @tool × 7

apps/server/build-in-skills/
  ├── baidu-search/                      # 示例技能 1
  │   └── SKILL.md                       # frontmatter 增 automation.operations
  └── oa-overtime/                       # 示例技能 2（含 confirmation_required）
      └── SKILL.md                       # frontmatter 增 automation.operations
```

### 2.5 7 个 @tool 工具清单

> ⚠️ **已废弃**：这 7 个 Python `browser_*` @tool 从未实现/已移除。等价能力现由 `browserctl` 子命令提供：`health` / `open|navigate` / `snapshot [--tree|--interactive]` / `click` / `fill [--text-file|--text-stdin]` / `wait` / `get` / `extract-text` / `screenshot` / `close`。详见 [browserctl reference](../apps/server/build-in-skills/browser-runtime/reference.md)。

| @tool 名 | 入参 | 行为 | 失败模式 |
|----------|------|------|----------|
| `browser_navigate` | `url: str, intent: str` | 跳转到 URL | `BROWSER_UNAVAILABLE` / `BLOCKED_DOMAIN` / `TIMEOUT` |
| `browser_click` | `ref_or_selector: str, intent: str, confirmation_required: bool = False` | 点击元素；`ref_or_selector` 支持 `@e5` 或 CSS `#su` | `ELEMENT_NOT_FOUND` / `STALE_REF` / `USER_CANCELLED` |
| `browser_fill` | `ref_or_selector: str, text: str, intent: str` | 在元素中填文本 | `ELEMENT_NOT_FOUND` / `NOT_EDITABLE` |
| `browser_snapshot` | `intent: str` | 返回 a11y 树（≤200 节点） | `BROWSER_UNAVAILABLE` / `TIMEOUT` |
| `browser_extract_text` | `intent: str` | 返回 `document.body.innerText` | 同上 |
| `browser_screenshot` | `intent: str` | 返回 base64 PNG | 同上 |
| `browser_get_url` / `browser_get_title` | — | 返回当前 URL / 标题 | 同上 |

**安全护栏**：
- 所有工具接 `intent: str`（与 `shell_execute_tool` 一致），用于前端 UI 展示
- snapshot 默认 200 节点截断；按"保留前 3 层 + 关键 role + 折叠子树"策略压缩
- 密码字段（`role=password` / `autocomplete=cc-*`）在 snapshot 中 mask
- 工具调用前 `webContents.debugger.attach()`，未 attach 时返回 `BROWSER_UNAVAILABLE`
- 与 devTools 互斥：开 devTools 时禁用自动化（工具栏显式开关）
- `browser_click(confirmation_required=True)` 触发单步 HITL 确认（详见 2.7）

### 2.6 SKILL.md frontmatter 自动化字段

**设计原则**：技能格式 = SKILL.md 顶部 YAML frontmatter 中的 `automation.operations` 字段，让 LLM 在调用 `browser_*` 工具时有**硬编码 selector 兜底**，避免在 a11y 树里挑错元素。**不引入 flow executor / 参数校验 / login 子流程 / outputs 提取**——LLM 仍是每步决策者，技能只是 selector 加速器。

#### 2.6.1 完整字段定义

```yaml
---
name: <技能 slug>                    # 与目录名一致
description: <一句话描述>             # LLM 决定是否启用此技能时读
# 可选：自动化操作清单
automation:
  target_url: <默认起始 URL>          # 可选，LLM 也可覆盖
  operations:                         # 有序操作列表
    - action: navigate | fill | click | select | wait_for | screenshot
      # 各 action 字段见下表
---
```

| action | 必填字段 | 可选字段 | 说明 |
|--------|----------|----------|------|
| `navigate` | `url` | — | 跳转到 URL |
| `fill` | `selector`, `value` | — | `value` 支持 `${var}` 模板变量 |
| `click` | `selector` | `confirmation_required`, `confirmation_message` | 详见 2.7 |
| `select` | `selector`, `value` | — | select 元素选 value |
| `wait_for` | `selector` | `timeout_ms: int = 5000` | 等元素出现 |
| `screenshot` | `filename: string` | — | 留档截图 |

#### 2.6.2 示例技能 1：百度搜索（baidu-search）

```markdown
# ~/.digital-employee/local-skills/default/baidu-search/SKILL.md
---
name: baidu-search
description: 在百度搜索关键词
automation:
  target_url: https://baidu.com
  operations:
    - action: navigate
      url: https://baidu.com
    - action: fill
      selector: "#kw"
      value: "${user_query}"
    - action: click
      selector: "#su"
      # 搜索无副作用，不需 confirmation
---

# 百度搜索

## 适用场景
- 用户说"打开百度搜索 XXX"时启用
- 已登录百度的用户可正常使用（无登录态需求）

## LLM 行为提示
1. 识别 frontmatter `automation.operations` 中的 `${user_query}` 变量
2. 从用户提问提取 `{ user_query: "..." }`
3. 依次调 `browser_navigate` → `browser_fill("#kw", ...)` → `browser_click("#su")`
4. 收到成功响应 → 自然语言回复
```

**端到端示例**：
- 用户："帮我打开百度搜索周杰伦"
- LLM 行为：提取 `{ user_query: "周杰伦" }` → 依次调 3 个工具
- 验证：百度搜索结果页加载

#### 2.6.3 示例技能 2：OA 加班申请（oa-overtime）

```markdown
# ~/.digital-employee/local-skills/default/oa-overtime/SKILL.md
---
name: oa-overtime
description: 公司OA系统加班申请
automation:
  target_url: https://oa.example.com/overtime/new
  operations:
    - action: navigate
      url: https://oa.example.com/overtime/new
    - action: wait_for
      selector: "#startTime"
      timeout_ms: 10000
    - action: fill
      selector: "#startTime"
      value: "${start_time}"
    - action: fill
      selector: "#endTime"
      value: "${end_time}"
    - action: fill
      selector: "#reason"
      value: "${reason}"
    - action: select
      selector: "#overtimeType"
      value: "加班"
    - action: click
      selector: "#submit"
      confirmation_required: true
      confirmation_message: "确认提交 ${start_time}-${end_time} 加班申请？"
---

# OA 加班申请

## 适用场景
- 用户在内嵌浏览器中已登录公司OA
- LLM 只需从用户提问提取开始/结束时间 + 原因

## LLM 行为提示
1. 识别 frontmatter `automation.operations` 中的 `${start_time}` / `${end_time}` / `${reason}` 三个变量
2. 从用户提问"帮我提个加班申请，今天9-19点"提取 `{ start_time: "09:00", end_time: "19:00", reason: "工作需要" }`
3. 依次调 7 个 `browser_*` 工具
4. 最后一步 `browser_click(confirmation_required=True)` → 弹确认框
5. 工具层弹确认框 → 用户点"确认" → submit 执行
```

### 2.7 HITL 与安全护栏

**核心机制：单步 confirmation**（不引入独立的 flow 引擎）。

#### 2.7.1 confirmation_required 流程

```
LLM 调 browser_click(selector="#submit", confirmation_required=True, message="...")
  ↓
@tool 内部执行前：
  - 截图当前页面 → 返回给前端
  - ipcRenderer.invoke('flow:await-confirmation', { selector, message, screenshot })
  ↓
前端 BrowserPanel 弹模态确认框：
  ┌──────────────────────────────────────┐
  │ 即将执行以下操作                      │
  │                                      │
  │  [screenshot 缩略图]                  │
  │                                      │
  │  确认提交 09:00-19:00 加班申请？      │
  │                                      │
  │  [取消]              [确认]           │
  └──────────────────────────────────────┘
  ↓
用户点"确认" → @tool 继续执行 Input.dispatchMouseEvent
用户点"取消" → @tool 返回 USER_CANCELLED
```

#### 2.7.2 安全护栏清单

| 护栏 | 实现 |
|------|------|
| 密码字段 mask | snapshot 阶段 `role=password` / `autocomplete=cc-*` 输出 `[REDACTED]` |
| 工具调用 timeout | `@tool` 内部 `asyncio.wait_for(30s)` |
| URL 白名单 | `~/.digital-employee/configs/browser-allowlist.json` 默认 `"*"` |
| 全量审计 | 每条 `browser_*` 工具调用记 `browser_audit_log`（含截图） |
| 操作可见性 | 前端高亮环 3s 黄色边框，避免用户与 agent 抢焦点 |
| 与 devTools 互斥 | 工具栏显式开关（开自动化即关 devTools） |

---

## 3. 实施阶段

> ⚠️ **已过时**：以下分阶段计划基于原 Python @tool 方案。实际实施进度（含 Skill 化、browserctl CLI、HITL、wait/screenshot/snapshot 文本、打包内置）以 [browser-runtime-roadmap.md](./browser-runtime-roadmap.md) 为准。

### 3.1 阶段 1 — MVP「内嵌三方页面 + 手动浏览」 ⏱ 1 周

**目标**：在主窗口右侧新增可拖拽（默认 60% 宽、30%–80% 区间）的子 `BrowserWindow`，承载任意 URL；用户可手动浏览；离线模式可用。

**新增文件**：
- `apps/web/electron/features/browser/browser-window-controller.ts`
- `apps/web/electron/features/browser/preload-bridge.ts`
- `apps/web/src/stores/browser-store.ts`
- `apps/web/src/components/chat/right-panels/browser-panel.tsx`
- `apps/web/src/components/chat/right-panels/browser-width-slider.tsx`

**修改文件**：
- `apps/web/electron/core/services/window-manager.ts` — `BuiltinWindowId` 加 `"browser"`
- `apps/web/electron/preload/electron-api.ts` — 注入 `browserBridge`
- `apps/web/electron/main/index.ts` — 启动顺序 + 主窗口 resize 转发
- `apps/web/src/components/chat/shell/chat-layout.tsx` — `RightPanel` 加 `"browser"`
- `apps/web/src/components/chat/shell/app-toolbar.tsx` — Globe 按钮

**宽高同步逻辑**：
```typescript
function calcBounds(mainBounds, widthRatio, headerHeight) {
  return {
    x: Math.round(mainBounds.x + mainBounds.width * (1 - widthRatio)),
    y: mainBounds.y + headerHeight,  // 避开 macOS traffic light
    width: Math.round(mainBounds.width * widthRatio),
    height: mainBounds.height - headerHeight,
  }
}
```

**验收标准**：
- [ ] 打开主窗口 → 点工具栏 Globe → 右侧抽屉出现，宽 60% 主窗口
- [ ] URL bar 输入 `https://example.com` → 子窗口加载
- [ ] 拖动宽度滑块 30% / 80% → 子窗口同步
- [ ] 关闭抽屉 → 子窗口隐藏但 partition 保留 Cookie
- [ ] 切到 Workbench / Skills tab → 浏览器面板同步隐藏
- [ ] `OFFLINE_MODE=1` 启动 → 仍能加载离线可达页面
- [ ] macOS / Windows / Linux 三端冒烟通过

### 3.2 阶段 2 — 7 个 @tool + 2 个示例技能 ⏱ 1.5 周

**目标**：让 deepagent 数字员工能"看"页面（a11y snapshot + 截图）、"操作"页面（点击 / 填表 / 提取文本）；通过 SKILL.md frontmatter 的 `automation.operations` 字段提供 2 个内置示例技能（baidu-search + oa-overtime）作为端到端 demo；前端显示高亮环避免抢焦点。

**新增文件**：
- `apps/web/electron/features/browser/browser-debugger-controller.ts`
- `apps/web/electron/features/browser/browser-highlight.ts`
- `apps/server/src/service/browser/browser_runtime_client.py`
- `apps/server/src/service/browser/http_routes.py`
- `apps/server/src/service/agent/tools/browser.py`
- `apps/server/build-in-skills/baidu-search/SKILL.md`（frontmatter 含 `automation.operations`）
- `apps/server/build-in-skills/oa-overtime/SKILL.md`（frontmatter 含 `automation.operations`）

**修改文件**：
- `apps/server/src/service/agent/employee.py` — `extra_tools` 加 `*browser_tools`
- `apps/server/src/service/agent/orchestrator/agent.py` — `tools=[...]` 同步加
- `apps/server/src/api/router.py`（如有总注册点）— 挂 `/internal/browser/*`
- `apps/web/src/components/chat/right-panels/browser-panel.tsx` — 集成高亮环 + confirmation 模态框

**关键算法 — @eN ref 编号**：
```typescript
function buildRefs(axTree: AXNode, maxNodes = 200): RefNode[] {
  const refs: RefNode[] = []
  let counter = 0

  function walk(node: AXNode, depth: number) {
    if (refs.length >= maxNodes) return
    if (node.role === "none" || node.hidden) return
    if (["presentation", "none", "generic"].includes(node.role) && !node.name && depth > 2) return

    const ref = `@e${counter++}`
    refs.push({
      ref,
      role: node.role,
      name: node.name || null,
      value: node.value || null,
      backendNodeId: node.backendNodeId,
      depth,
    })

    if (node.children?.length) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }

  walk(axTree, 0)
  return refs
}
```

**CDP 协议示例 — navigate**：
```json
// Request
POST /internal/browser/default/navigate
{ "url": "https://example.com" }

// Electron 内部
webContents.debugger.sendCommand("Page.enable")
webContents.debugger.sendCommand("Page.navigate", { url })
// 等 Page.loadEventFired（带 timeout 30s）

// Response
{ "ok": true, "url": "https://example.com", "title": "Example Domain" }
```

**端到端 demo 1：百度搜索**（路径 A — 技能加速）
- 对话："帮我打开百度搜索周杰伦"
- LLM 读 `baidu-search/SKILL.md` frontmatter 的 `automation.operations` → 识别 `${user_query}` 变量
- 提取变量 `{ user_query: "周杰伦" }`
- 依次调 `browser_navigate` / `browser_fill("#kw", "周杰伦")` / `browser_click("#su")`
- 验证：百度搜索结果页加载

**端到端 demo 2：OA 加班申请**（路径 A — 技能加速 + confirmation）
- 对话："帮我提个加班申请，今天9-19点"
- LLM 读 `oa-overtime/SKILL.md` frontmatter 的 `automation.operations` → 识别 3 个变量
- 提取 `{ start_time: "09:00", end_time: "19:00", reason: "工作需要" }`
- 依次调 7 个 `browser_*` 工具；最后一步 `browser_click(confirmation_required=True)`
- 验证：前端弹出确认框 → 用户点"确认" → 提交成功

**端到端 demo 3：未知站点**（路径 B — 自然语言探索）
- 对话："把 example.com 首页所有链接列出来"
- 无对应 skill → LLM 调 `browser_navigate` → `browser_snapshot` → 看 a11y 树 → 推理出 link 元素 → `browser_click(@e5)` 等
- 验证：返回的链接列表 ≥5 条

**验收标准**：
- [ ] 对话："打开 example.com 列出所有链接" → agent navigate → snapshot → 返回 ≥5 节点
- [ ] 对话："点第 3 个链接" → agent 用 `@e3` click → 前端 3s 黄色高亮环
- [ ] 对话："在搜索框输入 'hello'" → agent fill → 三方页面搜索框出现 "hello"
- [ ] 对话："帮我打开百度搜索周杰伦" → 端到端跑通 baidu-search
- [ ] 对话："帮我提个加班申请，今天9-19点" → 弹出确认框 → 用户确认 → 提交成功
- [ ] `OFFLINE_MODE=1` + 离线 demo 页面 → 完整流程跑通
- [ ] token 预算：200 节点 snapshot ≤ 2k tokens
- [ ] 密码字段（飞书登录页）不暴露在 snapshot 中

### 3.3 阶段 3 — Session 隔离 + 审计 + 安全 ⏱ 1 周

**目标**：多 conversation 隔离 Cookie；全量审计日志；URL 白名单留口（默认全开）；设置页可视化。

**新增文件**：
- `apps/web/electron/features/browser/browser-session-store.ts`
- `apps/web/electron/features/browser/url-allowlist.ts`
- `apps/web/electron/features/browser/audit-log.ts`
- `apps/server/src/service/browser/audit_log.py`
- `apps/web/src/components/settings/browser-settings-section.tsx`

**修改文件**：
- `apps/web/electron/features/browser/browser-http_bridge.py`（或新建）— `/internal/browser/{session_id}/*` 路由到对应 partition
- `apps/web/electron/features/browser/preload-bridge.ts` — `openBrowser(sessionId, url)` 接受会话参数
- `apps/web/src/components/chat/right-panels/browser-panel.tsx` — 顶部"审计时间线"小窗

**审计表结构**：
```sql
CREATE TABLE browser_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  conversation_id TEXT NOT NULL,
  employee_id TEXT,
  action TEXT NOT NULL,         -- navigate / click / fill / snapshot / ...
  ref TEXT,                     -- @eN
  url TEXT,
  intent TEXT,
  blocked INTEGER DEFAULT 0,    -- 0/1
  screenshot_path TEXT,
  error TEXT
);
CREATE INDEX idx_audit_conv_ts ON browser_audit_log(conversation_id, ts);
```

**URL 白名单配置** (`~/.digital-employee/configs/browser-allowlist.json`)：
```json
{
  "allow": ["*"],
  "deny": [],
  "ask_each_time": false,
  "audit": true
}
```

**验收标准**：
- [ ] 两个 conversation 同时打开浏览器 → 互不污染 Cookie（DevTools 验证 partition 独立）
- [ ] 审计日志最近 100 条在设置页可视化
- [ ] 诊断 zip 导出包含 `browser_audit_log.json` + `browser-screenshots/`
- [ ] 运维修改 `allow: ["*.example.com"]` 后访问 `https://evil.com` → 拦截 + 写 audit

### 3.4 阶段 4 — Skill 化 + 文档化 ⏱ 0.5 周

**目标**：把能力以"浏览器操作 skill"形式暴露给总管 / 员工；写完整架构 + 开发者文档。

**新增文件**：
- `apps/server/build-in-skills/browser-automation/SKILL.md`
- `apps/server/docs/browser-architecture.md`

**修改文件**：
- `apps/server/src/service/agent/AGENTS.md` — 增加"浏览器操作"章节
- `apps/web/electron/README.md` — 增补"内嵌浏览器"章节
- `apps/server/src/service/employee_service.py` — 默认员工清单加"浏览器操作助手"

**SKILL.md 内容大纲**：
```markdown
# 浏览器操作助手

## 适用场景
- 三方业务系统无 OpenAPI，但需在对话中辅助操作
- 用户在内嵌浏览器中已登录，agent 可"代为点击"
- 需要跨多步表单操作（如登录、申请、查询）

## 可用工具
- browser_navigate / browser_click / browser_fill
- browser_snapshot / browser_extract_text / browser_screenshot
- browser_get_url / browser_get_title

## 最佳实践
1. 先 snapshot 获取 ref，再 click/fill
2. snapshot 默认 200 节点，按需重 snapshot
3. 错误恢复：ELEMENT_NOT_FOUND → 重新 snapshot
4. 安全：不向用户索要密码，由用户在内嵌浏览器中手动登录
```

**验收标准**：
- [ ] 默认安装内置员工"浏览器操作助手"
- [ ] 在技能市场可见、可绑定
- [ ] 阅读开发者文档 10 分钟内可完成"打开百度 → 搜索"端到端 demo

---

## 4. 文件改动总览

> ⚠️ **已过时**：本节的 Python `browser_tool.py` / `BrowserRuntimeClient` / FastAPI 路由等改动未采用。实际涉及文件：`packages/browserctl/`、`apps/web/electron/features/browser/`、`apps/web/electron/features/backend/backend-process.ts`、`apps/server/build-in-skills/browser-runtime/`。

**新增 14 个**：

```
apps/web/electron/features/browser/
  ├── browser-window-controller.ts        (新)
  ├── browser-debugger-controller.ts      (新)
  ├── browser-session-store.ts            (新)
  ├── url-allowlist.ts                    (新)
  ├── audit-log.ts                        (新)
  ├── browser-highlight.ts                (新)
  └── preload-bridge.ts                   (新)
apps/web/src/
  ├── stores/browser-store.ts             (新)
  ├── components/chat/right-panels/
  │   ├── browser-panel.tsx               (新)
  │   └── browser-width-slider.tsx        (新)
  └── components/settings/
      └── browser-settings-section.tsx    (新)
apps/server/src/service/
  ├── browser/
  │   ├── browser_runtime_client.py       (新)
  │   ├── audit_log.py                    (新)
  │   └── http_routes.py                  (新)
  └── agent/tools/
      └── browser.py                      (新)
apps/server/build-in-skills/
  ├── baidu-search/                       (新) ← 示例技能 1
  │   └── SKILL.md                        (frontmatter 含 automation.operations)
  └── oa-overtime/                        (新) ← 示例技能 2
      └── SKILL.md                        (frontmatter 含 automation.operations)
apps/server/docs/
  └── browser-architecture.md             (新)
docs/
  └── embedded-browser-panel-prd.md       (本文件)
```

**修改 9 个**：

```
apps/web/electron/core/services/window-manager.ts        # BuiltinWindowId += "browser"
apps/web/electron/preload/electron-api.ts                 # 注入 browserBridge
apps/web/electron/main/index.ts                          # 启动顺序 + resize 转发
apps/web/src/components/chat/shell/chat-layout.tsx        # RightPanel += "browser"
apps/web/src/components/chat/shell/app-toolbar.tsx        # Globe 按钮
apps/server/src/service/agent/employee.py                 # extra_tools += browser_tools
apps/server/src/service/agent/orchestrator/agent.py       # tools += browser_tools
apps/server/src/service/agent/AGENTS.md                   # 文档增补
apps/server/src/service/employee_service.py               # 默认员工 += "浏览器操作助手"
```

---

## 5. 依赖 / 打包

| 维度 | 变化 |
|------|------|
| `apps/server/pyproject.toml` | 0 改动（`httpx` 已存在） |
| `apps/web/package.json` | 0 改动（Electron 41 + aiohttp 由 Python 提供） |
| `scripts/build-server.py` | 0 改动（不打新二进制） |
| 安装包大小 | **+0 MB**（完全复用 Electron 自带 Chromium） |
| 启动时间 | +0.1s（aiohttp 路由挂载） |

---

## 6. 风险与缓解

| # | 风险 | 等级 | 缓解 |
|---|------|------|------|
| 1 | CDP 在 Electron 41 的 domain 限制 | 中 | 阶段 2 先 `Page.navigate + Runtime.evaluate` 跑通再展开 `Accessibility.getFullAXTree` |
| 2 | macOS 子 `BrowserWindow` 焦点异常 | 中 | 阶段 1 macOS 专项测试；问题回退到"独立窗口 + 坐标同步" |
| 3 | `webContents.debugger` 与 `devTools` 互斥 | 低 | 工具栏显式开关（开自动化即关 devTools） |
| 4 | agent snapshot token 爆炸 | 中 | 默认 200 节点 + 关键 role 优先压缩；提供"窄模式 snapshot"工具 |
| 5 | agent 读到密码字段 | 高 | snapshot 阶段 mask `role=password` / `autocomplete=cc-*` / `type=password` |
| 6 | 多 conversation 串扰 | 中 | 阶段 3 强制 partition 隔离 |
| 7 | 三方页面 CSP 拒绝内嵌 | 低 | 文档说明；allowlist 由用户配；不做技术绕过 |
| 8 | 工具调用阻塞 SSE 流 | 中 | 工具内部 `asyncio.wait_for(30s)`；超时返回 `TIMEOUT` |
| 9 | 主进程 `webContents.debugger` 跨多 BrowserWindow 命名冲突 | 低 | 每 BrowserWindow 独立 debugger instance，session_id 路由 |
| 10 | aiohttp 嵌入到后端进程的安全风险 | 低 | 仅监听 `127.0.0.1`；不暴露外网；FastAPI middleware 鉴权 |
| 11 | **selector 失效**（三方系统改版） | 中 | `browser_click` 返回 `ELEMENT_NOT_FOUND` 时 LLM 应回退到 `browser_snapshot` 重新发现元素；技能版本号 + 监控 |
| 12 | **技能版本不匹配** | 低 | SKILL.md frontmatter `automation.operations.version` 加载时校验与 SKILL.md body 的版本字段一致；CI 校验 |

---

## 7. 验收 / 验证矩阵

| 阶段 | 单元测试 | 集成测试 | 端到端 | 三端冒烟 |
|------|----------|----------|--------|----------|
| 1 | — | `pnpm typecheck && pnpm lint` | 手动三步：点 Globe → 输 URL → 拖滑块 | macOS / Windows / Linux |
| 2 | `tests/test_browser_runtime_client.py`（mock aiohttp） | `tests/test_browser_tools.py`（mock controller） | 对话"打开 example.com 列出链接" | macOS / Windows / Linux |
| 3 | `tests/test_audit_log.py` | `tests/test_session_isolation.py` | 两个 conv 同时打开 | macOS / Windows / Linux |
| 4 | — | — | 阅读文档 10min demo | — |

### 7.1 自动化验证脚本

```python
# tests/test_browser_e2e.py
async def test_browser_navigate_then_snapshot():
    client = BrowserRuntimeClient("http://127.0.0.1:34555")
    nav = await client.navigate("default", "https://example.com")
    assert nav.ok

    snap = await client.snapshot("default")
    assert len(snap.refs) >= 5
    assert any(r["role"] == "link" for r in snap.refs)

async def test_browser_click_ref():
    client = BrowserRuntimeClient("http://127.0.0.1:34555")
    await client.navigate("default", "https://example.com")
    snap = await client.snapshot("default")
    first_link = next(r for r in snap.refs if r["role"] == "link")
    click = await client.click("default", first_link["ref"])
    assert click.ok
```

---

## 8. 排期

| 阶段 | 周期 | 累计 |
|------|------|------|
| 阶段 1 — MVP 手动浏览 | 1 周 | 1 周 |
| 阶段 2 — 7 @tool + 2 示例技能 | 1.5 周 | 2.5 周 |
| 阶段 3 — Session 隔离 + 审计 | 1 周 | 3.5 周 |
| 阶段 4 — Skill 化 + 文档 | 0.5 周 | **4 周** |

总投入约 **1 人月**（含联调、自测、文档）。

---

## 9. 附录

### 9.1 现有相关代码位置速查

> ⚠️ **部分过时**：涉及 Python browser 层的条目已移除。当前实现入口：`packages/browserctl/src/index.js`（CLI）、`apps/web/electron/features/browser/browser-http-bridge.ts`（bridge）、`browser-debugger-controller.ts`（CDP）、`apps/server/build-in-skills/browser-runtime/`（Skill）。

- 主窗口右抽屉机制：`apps/web/src/components/chat/shell/chat-layout.tsx:243-350`
- BrowserWindow 工厂：`apps/web/electron/core/services/window-manager.ts:86-138`
- preload 桥聚合：`apps/web/electron/preload/electron-api.ts:12-24`
- zustand store 模板：`apps/web/src/stores/monitor-store.ts:16-44`
- 工具注册模式：`apps/server/src/service/agent/employee.py:191-199`
- shell tool 模板：`apps/server/src/service/agent/shell_execute_tool.py:55-96`
- 现有 `webContents.setWindowOpenHandler`：`apps/web/electron/main/index.ts:140-143`
- 离线模式配置：`apps/server/src/core/runtime_capabilities.py:18-43`
- PyInstaller 打包脚本：`scripts/build-server.py`（无需改动）
- 内置 skill 模板：`apps/server/build-in-skills/feishu-workbench/SKILL.md`（155 行）
- 架构文档模板：`apps/server/docs/hitl-architecture.md`

### 9.2 关键第三方依赖

- **Electron 41.1.0** — `apps/web/package.json`
- **deepagents 0.6.7** — `apps/server/pyproject.toml:8`
- **Python 3.x**（现有）
- **Node 20+**（现有）

### 9.3 参考资料

- [agent-browser](https://github.com/vercel-labs/agent-browser) — Rust CLI，CDP + a11y 范式；`@eN` ref 编号算法与 a11y tree 抽取思路的灵感来源
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/) — `Accessibility` / `Page` / `Input` / `Runtime` domains
- [Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) — 现代子窗口方案
- [Electron Session](https://www.electronjs.org/docs/latest/api/session) — partition 隔离 Cookie
- [deepagents](https://github.com/langchain-ai/deepagents) — `@tool` 装饰器范式

---

## 10. 评审记录

| 日期 | 评审人 | 状态 | 备注 |
|------|--------|------|------|
| 2026-06-01 | — | 待评审 | 初稿 |

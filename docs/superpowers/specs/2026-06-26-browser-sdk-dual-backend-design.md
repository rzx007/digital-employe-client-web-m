# Browser SDK 双后端(Electron + 独立 Chrome/Edge)— 设计

- 日期：2026-06-26
- 状态：设计与用户逐节确认，待 spec review
- 范围：**纯地基**（双后端重构 + launch/connect + 持久 profile + 现有命令迁移跑通）。命令对齐 agent-browser 的 P1–P3 增量、OA 业务 skill 均为后续独立子项目。

## 背景与目标

当前 browserctl 三层：`CLI(packages/browserctl/src/index.js)` → `bridge(browser-http-bridge.ts，34555)` → `controller(browser-debugger-controller.ts，CDP via webContents.debugger)`，操作 Electron 的 `WebContentsView`。

- **CLI 已是纯 HTTP 瘦客户端**（零 Electron / 零三方依赖），本就与宿主解耦。
- **耦合全在执行底座**：controller 的 CDP 走单点 `this.sendCommand()`；bridge 直接依赖 `window-controller`（拿 `webContents`、创建/关闭 view、会话归属）和 `requestBrowserConfirmation`（Electron 原生对话框）。
- 现有 `CLI → bridge` 本质就是 **client-daemon 架构**，与 agent-browser 的 Rust daemon 同形。

**目标**：把 bridge + controller 的命令逻辑抽成**与宿主无关的 SDK**，通过两套适配器同时驱动：
1. **Electron `WebContentsView`**（现状，进程内 `webContents.debugger`）；
2. **独立 Chrome/Edge**（CDP-over-WebSocket，由独立 daemon launch 持久 profile 实例，或 connect 已运行实例）。

**同一套 `browserctl open/snapshot/click/fill/...` 命令逐字一致地驱动两种后端**——CLI 零改。

## 非目标（本期不做）

- **P1–P3 命令对齐**（back/forward/reload、hover/check、cookies/storage/state、tabs、frame 显式切换、network、find 语义定位器等）——地基之上增量，后续分批。
- **OA 业务自动化封装成 skill**——子项目，依赖地基。
- **跨源 OOPIF 操作**——transport 接口预留事件钩子（为 `Target.setAutoAttach` 铺路），但本期同源 iframe 已够（两后端通用）。
- **HITL 三端可插拔**——独立后端 `--confirm` 一律放行 + 审计日志；Electron 保持原生对话框。

## 架构：client-daemon 双宿主

```
CLI (index.js, 不改) --HTTP:34555--> Bridge(SDK，薄 action 分发)
                                       └ BrowserController(命令逻辑 = SDK 核心，纯 CDP)
                                           ├ Transport 接口
                                           │   ├ ElectronDebuggerTransport (webContents.debugger)  ← Electron 主进程
                                           │   └ ChromeCdpTransport        (CDP-over-WS)            ← 独立 daemon
                                           └ Host 接口 (confirm / 产物路径 / 可见性 / ensureBrowser)
                                               ├ ElectronHost   (原生确认 / 会话产物 / 右栏 / window-controller 建 view)
                                               └ StandaloneHost (放行+日志 / cwd 产物 / no-op / launch·connect Chrome)
```

- **Electron 模式**：bridge 在主进程，挂 Electron 适配（现状行为不变）。
- **独立模式**：`browserctl-daemon` 进程内同一个 bridge+SDK，挂 Chrome 适配，监听 34555；CLI 照常打。

## SDK 包结构

**新建 `packages/browser-sdk`**（纯 TS，零宿主依赖）：

| 文件 | 职责 |
|---|---|
| `controller.ts` | `BrowserController`——命令逻辑（snapshot/click/fill/select/get/scroll/press/wait/navigate + 同源 iframe）。构造注入 `transport` + `host`。从 `browser-debugger-controller.ts` 抽出、去 Electron 化 |
| `ax-tree.ts` / `frame-tree.ts` | 纯函数，直接移入 |
| `transport.ts` | `Transport` 接口 |
| `host.ts` | `Host` 接口 |
| `bridge.ts` | `createBridge(controller, host)`——从 `browser-http-bridge.ts` 抽出 action 分发（通用化），返回 `http.Server` |

### 两个接口

```ts
interface Transport {
  attach(): Promise<void>
  detach(): Promise<void>
  sendCommand(method: string, params?: object): Promise<unknown>
  isAttached(): boolean
  on(event: "message", cb: (m: string, p: unknown, sessionId?: string) => void): void  // 预留 OOPIF auto-attach
}

interface Host {
  requestConfirmation(message: string): Promise<boolean>  // Electron=原生对话框；Standalone=放行+审计日志→true
  resolveArtifactPath(nameOrPath: string): string          // screenshot 落盘 / open-artifact
  beforeInteraction?(): void                               // Electron=confirm 期 suppress 可见性；Standalone no-op
  ensureBrowser(url?: string): Promise<void>               // open 时确保浏览器实例就绪（Electron 建 view；Standalone launch/connect）
  setActiveSession?(id: string): void                      // Electron 会话归属；Standalone no-op
  close(): Promise<void>                                    // 关浏览器实例
}
```

## 关键重构点：命令必须纯 CDP 化

**已是纯 CDP、直接复用**（均走 `this.sendCommand()`）：snapshot、click、fill、select、press、scroll、get-value、get-attribute、**extract-text**（`Runtime.evaluate` innerText）、**screenshot**（`Page.captureScreenshot`）、waitForReady。

**真正需要迁移的**——现仍依赖 Electron `webContents` 原生 API（独立后端没有 `webContents` 对象）：

| 点 | 现状（Electron 原生） | 迁移为（纯 CDP） |
|---|---|---|
| `navigate` 加载 | **bridge `handleNavigate` 用 `wc.loadURL(url)`**（最 Electron 特有、无 CDP 等价） | `Page.navigate` + 等 `Page.loadEventFired` |
| `navigate` 返回值 | load 后 `wc.getURL()` / `wc.getTitle()` | `Target.getTargetInfo` / `Runtime.evaluate("document.title")` |
| `get-url` | bridge `wc.getURL()` **+ controller `getUrl()` 的 `this.wc.getURL()` fast-path** | `Page.getNavigationHistory` / `Target.getTargetInfo` |
| `get-title` | bridge `wc.getTitle()` **+ controller `getTitle()` fast-path** | `Runtime.evaluate("document.title")` |
| `health` | bridge `handleHealth` 的 `wc.getURL()/getTitle()` | 同上；或 health 作为 bridge 级宿主探活、留 Electron 侧（实现时定） |

> get-url/get-title 有 **bridge 与 controller 两层** fast-path，迁移要两层都去。

**Electron-only glue → 归 ElectronHost，不进 SDK**（独立后端 no-op）：
- `navigate` 的 `notifyRequestOpen` IPC / `waitForBrowserWebContents` 轮询 / `controller.open` / `prepareViewportForBridge` → `ElectronHost.ensureBrowser`（独立 = launch/connect）。注意 bridge 的 `navigate` 不是简单 `controller.navigate`，而是先 `ensureBrowser` 这串多步流程，别 under-scope。
- `click` 的 `flashHighlight(wc, ...)` 视觉高亮 → `ElectronHost` 内部（可选 `Host.afterClick?()`，独立 no-op）。
- `close` 的 `browser:request-close` IPC → `ElectronHost.close()`。

实现时先**逐一审计 bridge 每个 action**，按上表分类（纯 CDP 复用 / 迁移 / Electron glue 归 Host）再动手。这是地基的主要工作量。

## 独立 daemon（`packages/browserctl-daemon`）

```bash
browserctl-daemon --browser chrome            # 或 edge
                  [--headless]                 # 默认 headed（OA 首登要可见）
                  [--user-data-dir <path>]     # 默认 ~/.browserctl/profile-<browser>（持久登录态）
                  [--port 34555]               # 默认 34555，与 CLI 默认对齐 → 零配置
                  [--executable <path>]        # 可执行探测失败时手动指定
                  [--cdp <port|ws-url>]        # connect 已运行实例（跳过 launch）
```

流程（launch 分支）：
1. `chrome-launcher` 启动 Chrome/Edge，持久 `--user-data-dir` + `--remote-debugging-port=0`；
2. 读 WS endpoint → `ChromeCdpTransport.attach()`；
3. `createBridge(new BrowserController(chromeTransport, standaloneHost), standaloneHost)` 监听 34555；
4. 常驻，CLI 多次命令复用同一连接、同一浏览器会话（持久 profile）；退出关浏览器（`--cdp` connect 模式不关，归用户）。

connect 分支（`--cdp`）：跳过 launch，直接连给定端口/WS。launch 与 connect **共用 `ChromeCdpTransport` 同一 WS 客户端**，仅实例来源不同。

**登录态（OA）**：headed + 持久 profile，首次人工（或后续 OA skill 用 `fill`）登录一次，cookie/SSO 存进 `--user-data-dir`，之后无人值守复用。具体登录编排归子项目。

## 适配差异

| 能力 | ElectronHost | StandaloneHost |
|---|---|---|
| `requestConfirmation` | 原生对话框 + `beforeInteraction` suppress 可见性 | 放行 + 审计日志 → true |
| `resolveArtifactPath` | 会话产物目录（`CONVERSATION_ID`/`$ARTIFACTS_DIR`） | cwd / `--out` 绝对路径 |
| `ensureBrowser` | window-controller 建/显示 `WebContentsView` | launch 持久 profile / connect |
| `setActiveSession` | 会话归属（现 `setActiveConversationId`） | no-op |
| open-artifact | 数字员工产物 HTML + static 端点 | 不适用 → 报 `UNSUPPORTED_IN_STANDALONE` |
| 同源 iframe | ✅ 标准 CDP（刚做的 frame walk） | ✅ 同左 |

## 技术选型（独立后端）

- **`chrome-launcher`**（Google/Lighthouse 生态）：跨平台探测 Chrome/Edge 可执行、管 user-data-dir、起 remote-debugging-port。成熟，省掉自写 spawn/探测。
- **`chrome-remote-interface`**：轻量 CDP-over-WS 客户端，命令（`client.send(method, params)`）+ 事件（`client.on(...)`）模型，直接适配 `Transport` 接口。避免自写 CDP 协议。
- 两者均为 daemon 包依赖；**SDK 包与 CLI 保持零三方依赖**。

## 数据流（独立模式）

```
browserctl-daemon --browser chrome
  → chrome-launcher launch（持久 user-data-dir, 调试端口）
  → ChromeCdpTransport.attach()（chrome-remote-interface 连 WS）
  → createBridge(controller, standaloneHost) listen :34555
browserctl open https://oa.example.com   （CLI POST /open）
  → bridge → host.ensureBrowser(url) → controller.navigate → transport.sendCommand("Page.navigate")
browserctl snapshot --interactive
  → controller.snapshot → Page.getFrameTree + getFullAXTree（含同源 iframe）→ @eN
browserctl fill @e3 "账号" / click @e9
  → 纯 CDP，真实操作
```

## 错误处理

- transport 连接失败（WS 断/Chrome 崩）→ `BROWSER_UNAVAILABLE`，daemon 可重启重连。
- `chrome-launcher` 找不到可执行 → 明确报错提示 `--executable`。
- 独立后端遇 Electron 专属 action（open-artifact）→ `UNSUPPORTED_IN_STANDALONE`。
- 现有错误码（ELEMENT_NOT_FOUND/TIMEOUT/USER_CANCELLED…）保持，bridge 的 `errorCode` 映射移入 SDK。

## 测试策略

- **SDK 命令逻辑单测**：现有 `ax-tree.test.ts` / `frame-tree.test.ts` 移入 SDK 包；`BrowserController` 用 **mock transport** 测命令拼装与解析（node:test）。
- **Chrome transport 集成测试（大彩蛋）**：`chrome-launcher` 起 **headless Chrome**，真实跑 snapshot/click/fill/select/同源 iframe——**把之前要手动重启 dev:app 的 E2E 自动化**。这是双后端的最大附带收益。
- **Electron 适配**：保持现状手动 GUI E2E（无回归）。

## 受影响 / 新增文件

| 路径 | 动作 |
|---|---|
| `packages/browser-sdk/*` | 新建：controller / ax-tree / frame-tree / transport / host / bridge |
| `packages/browserctl-daemon/*` | 新建：chrome-transport / standalone-host / daemon 入口（依赖 chrome-launcher + chrome-remote-interface） |
| `apps/web/electron/features/browser/electron-transport.ts` | 新建：`webContents.debugger` 实现 Transport |
| `apps/web/electron/features/browser/electron-host.ts` | 新建：confirm/产物/可见性/ensureBrowser(window-controller)/会话 实现 Host |
| `apps/web/electron/features/browser/browser-http-bridge.ts` | 改：改用 SDK `createBridge` + 注入 Electron transport/host；保留 window-controller 实例创建 |
| `apps/web/electron/features/browser/browser-debugger-controller.ts` | 改：命令逻辑迁入 SDK，仅留薄 Electron 胶水（或删除） |
| `packages/browserctl/src/index.js` | 基本不改；文档补独立 daemon 用法（`browserctl-daemon`、`BROWSER_RUNTIME_BRIDGE_URL`） |

## 风险与 spike

- **CDP 化审计**（最大不确定）：逐一确认现有 action 哪些依赖 `webContents` 原生 API，全部改纯 CDP。先列清单再动。
- **Edge 可执行探测**：`chrome-launcher` 默认找 Chrome，Edge 需指定 channel/`--executable`，spike 验证。
- **`chrome-remote-interface` 适配 Transport**：确认其 `send`/事件模型能干净实现接口（含 detach/重连）。
- **Electron transport 的事件**：`webContents.debugger` 的 `message` 事件 → `Transport.on("message")` 适配（为 OOPIF 预留，本期可空实现）。
- **monorepo 依赖方向**：`apps/web` 与 `browserctl-daemon` 均依赖 `packages/browser-sdk`；确认 turbo/pnpm workspace 构建顺序。

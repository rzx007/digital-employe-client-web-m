# Browser SDK 双后端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 browserctl 的命令逻辑抽成与宿主无关的 `@workspace/browser-sdk`，通过 Transport+Host 适配层同时驱动 Electron WebContentsView（现状）和独立 Chrome/Edge（新 daemon，CDP-over-WS），CLI 零改。

**Architecture:** SDK 含纯 CDP 的 `BrowserController` + `Transport`/`Host` 接口 + 通用 `createBridge`。Electron 侧实现 `ElectronDebuggerTransport`/`ElectronHost`（包 `window-controller`），独立侧新建 `@workspace/browserctl-daemon`（`ChromeCdpTransport`/`StandaloneHost` + `chrome-launcher` launch 持久 profile）。

**Tech Stack:** TypeScript, node:test + tsx, Electron `webContents.debugger`(CDP), `chrome-launcher` + `chrome-remote-interface`(独立后端), pnpm workspace + turbo。

**Spec:** [docs/superpowers/specs/2026-06-26-browser-sdk-dual-backend-design.md](../specs/2026-06-26-browser-sdk-dual-backend-design.md)

**分支:** `feat/browser-sdk-dual-backend`

**约定:** 子代理只 `git add` 自己明确列出的文件,**禁止** `git add .` / `-A` / `git commit -a`。

**测试运行:**
- SDK 包: `cd packages/browser-sdk && node --import tsx --test test/*.test.ts`（或 `npx tsx --test`，本环境 `node --import tsx` 可能需 `npx tsx --test` 兜底）
- daemon 集成: `cd packages/browserctl-daemon && npx tsx --test test/*.test.ts`

**阶段产出（每阶段可独立验证）:**
- Phase A：SDK 包 + 命令逻辑，mock transport 单测全绿。
- Phase B：Electron 后端改用 SDK，行为回归不变（手动 GUI E2E）。
- Phase C：独立 daemon 可 launch Chrome 跑命令。
- Phase D：headless Chrome 集成测试自动化。

---

## Phase A — SDK 包 + 命令逻辑

### Task A1: 创建 `@workspace/browser-sdk` 包骨架

**Files:**
- Create: `packages/browser-sdk/package.json`
- Create: `packages/browser-sdk/tsconfig.json`
- Create: `packages/browser-sdk/src/index.ts`

- [ ] **Step 1: package.json**

```json
{
  "name": "@workspace/browser-sdk",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "node --import tsx --test test/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: tsconfig.json**（参照 `packages/browserctl` 或 `packages/ui` 现有 tsconfig；strict、module ESNext、moduleResolution Bundler）。先复制 `packages/browserctl/tsconfig.json` 再按需调整。

- [ ] **Step 3: 占位 index.ts**

```ts
export {}
```

- [ ] **Step 4: 安装并确认 workspace 识别**

Run: `pnpm install`
Expected: 无报错，`@workspace/browser-sdk` 进入 workspace。

- [ ] **Step 5: Commit**

```bash
git add packages/browser-sdk/package.json packages/browser-sdk/tsconfig.json packages/browser-sdk/src/index.ts
git commit -m "feat(browser-sdk): 包骨架"
```

---

### Task A2: Transport + Host 接口

**Files:**
- Create: `packages/browser-sdk/src/transport.ts`
- Create: `packages/browser-sdk/src/host.ts`
- Modify: `packages/browser-sdk/src/index.ts`

- [ ] **Step 1: transport.ts**

```ts
// CDP 收发抽象。Electron(webContents.debugger) / 独立 Chrome(CDP-over-WS) 各一实现。
export interface Transport {
  attach(): Promise<void>
  detach(): Promise<void>
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
  isAttached(): boolean
  // 预留 OOPIF auto-attach（本期可空实现）
  on(event: "message", cb: (method: string, params: unknown, sessionId?: string) => void): void
}
```

- [ ] **Step 2: host.ts**

```ts
// 宿主能力抽象。Electron 实现完整，Standalone 多为简化/no-op。
export interface Host {
  requestConfirmation(message: string): Promise<boolean>  // Electron=原生对话框；Standalone=放行+审计日志→true
  resolveArtifactPath(nameOrPath: string): string          // screenshot 落盘 / open-artifact 解析
  ensureBrowser(url?: string): Promise<void>               // open/navigate 前确保实例就绪并 attach transport
  close(): Promise<void>                                    // 关浏览器实例
  beforeInteraction?(): void                               // Electron=confirm 期 suppress 可见性；Standalone no-op
  afterClick?(refOrSelector: string): void                 // Electron=flashHighlight；Standalone no-op
  setActiveSession?(id: string): void                      // Electron 会话归属；Standalone no-op
}
```

- [ ] **Step 3: 导出**

```ts
// index.ts
export type { Transport } from "./transport"
export type { Host } from "./host"
```

- [ ] **Step 4: typecheck**

Run: `cd packages/browser-sdk && npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add packages/browser-sdk/src/transport.ts packages/browser-sdk/src/host.ts packages/browser-sdk/src/index.ts
git commit -m "feat(browser-sdk): Transport + Host 接口"
```

---

### Task A3: 移入 ax-tree + frame-tree（含测试）

纯函数，原样搬迁。

**Files:**
- Create: `packages/browser-sdk/src/ax-tree.ts`（复制自 `apps/web/electron/features/browser/ax-tree.ts`）
- Create: `packages/browser-sdk/src/frame-tree.ts`（复制自 `apps/web/electron/features/browser/frame-tree.ts`）
- Create: `packages/browser-sdk/test/ax-tree.test.ts`（复制并改 import 路径 `../src/ax-tree`）
- Create: `packages/browser-sdk/test/frame-tree.test.ts`（同上）
- Modify: `packages/browser-sdk/src/index.ts`（导出 buildRefs/collectChildFrames + 类型）

> 注意:`apps/web` 侧的原文件**暂不删**——Phase B 让 apps/web 改为从 `@workspace/browser-sdk` 导入后再删，避免中间态编译断裂。

- [ ] **Step 1: 复制两个源文件到 `packages/browser-sdk/src/`**（内容不变）。

- [ ] **Step 2: 复制两个测试到 `packages/browser-sdk/test/`**，把 import 从 `"./ax-tree"` 改成 `"../src/ax-tree"`、`"./frame-tree"` 改成 `"../src/frame-tree"`。

- [ ] **Step 3: index.ts 追加导出**

```ts
export { buildRefs } from "./ax-tree"
export type { RefNode, AxNode } from "./ax-tree"
export { collectChildFrames } from "./frame-tree"
export type { FrameTreeNode } from "./frame-tree"
```

- [ ] **Step 4: 跑测试**

Run: `cd packages/browser-sdk && npx tsx --test test/ax-tree.test.ts test/frame-tree.test.ts`
Expected: ax-tree(8) + frame-tree(3) = 11 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/browser-sdk/src/ax-tree.ts packages/browser-sdk/src/frame-tree.ts packages/browser-sdk/test/ax-tree.test.ts packages/browser-sdk/test/frame-tree.test.ts packages/browser-sdk/src/index.ts
git commit -m "feat(browser-sdk): 移入 ax-tree + frame-tree(纯函数+测试)"
```

---

### Task A4: 迁入 BrowserController 并去 Electron 化

把 `browser-debugger-controller.ts` 的 `BrowserDebuggerController` 迁为 SDK 的 `BrowserController`：**构造注入 `transport`+`host`**，所有 `this.sendCommand` 委托 `transport`，删除 `attach/detach/wc/isAttached`（transport 管），`getUrl/getTitle` 去掉 `wc.getURL/getTitle` fast-path 改纯 CDP。命令逻辑（snapshot/click/fill/select/press/scroll/get-value/get-attribute/extract-text/screenshot/wait/navigate + iframe）原样保留。

**Files:**
- Create: `packages/browser-sdk/src/controller.ts`
- Create: `packages/browser-sdk/test/controller.test.ts`
- Modify: `packages/browser-sdk/src/index.ts`

- [ ] **Step 1: 写失败测试（mock transport 驱动命令逻辑）**

`test/controller.test.ts`：用一个记录 sendCommand 调用、可预设返回的 mock transport + no-op host，验证命令拼装/解析。

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { BrowserController } from "../src/controller"
import type { Transport } from "../src/transport"
import type { Host } from "../src/host"

function mockTransport(responses: Record<string, unknown> = {}): Transport & { calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = []
  return {
    calls,
    attach: async () => {},
    detach: async () => {},
    isAttached: () => true,
    on: () => {},
    sendCommand: async (method, params) => {
      calls.push([method, params])
      return responses[method] ?? {}
    },
  }
}
const noopHost: Host = {
  requestConfirmation: async () => true,
  resolveArtifactPath: (p) => p,
  ensureBrowser: async () => {},
  close: async () => {},
}

test("getUrl 走纯 CDP（不依赖 Electron webContents）", async () => {
  // 现有 CDP fallback 用 Runtime.evaluate("window.location.href")，按其返回形状 mock
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: "https://oa.example.com/" } },
  })
  const c = new BrowserController(t, noopHost)
  const r = await c.getUrl()
  assert.equal(r.ok, true)
  assert.equal((r.data as { url: string }).url, "https://oa.example.com/")
  // 全是 CDP 方法（含 "."），无 Electron 原生调用
  assert.ok(t.calls.every(([m]) => m.includes(".")))
})

test("snapshot 调 Accessibility.getFullAXTree（命令逻辑复用）", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t, noopHost)
  const r = await c.snapshot(50)
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getFullAXTree"))
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/browser-sdk && npx tsx --test test/controller.test.ts`
Expected: FAIL（controller.ts 不存在）。

- [ ] **Step 3: 迁入并改造 controller.ts**

从 `apps/web/electron/features/browser/browser-debugger-controller.ts` 复制类体到 `packages/browser-sdk/src/controller.ts`，重命名 `BrowserController`，做以下改动：

1. 删 `import type { WebContents } from "electron"`；改 import `buildRefs`/`AxNode`/`RefNode` 从 `"./ax-tree"`，`collectChildFrames`/`FrameTreeNode` 从 `"./frame-tree"`，并 `import type { Transport } from "./transport"`、`import type { Host } from "./host"`。
2. 构造函数：`constructor(private transport: Transport, private host: Host) {}`。删除 `wc`/`attached` 字段（保留 `refCache`）。
3. 删除 `attach(webContents)`/`detach()`/`isAttached()`/`getWebContents()`（生命周期归 transport）。
4. 私有 `sendCommand` 改为：`return this.transport.sendCommand(method, params)`（删 isAttached/wc 检查，transport 内部保证）。
5. `getUrl()`：删 `wc.getURL()` fast-path，**保留 controller 里已有的 CDP fallback `Runtime.evaluate("window.location.href")`** 作为唯一路径（最简、已在现有代码验证；不必换成 Page.getNavigationHistory）。
6. `getTitle()`：删 `wc.getTitle()` fast-path，保留已有 `Runtime.evaluate("document.title")` 作为唯一路径。
7. 其余方法（snapshot/click/fill/select/press/scroll/clearElement/runOnElement/getValue/getAttribute/waitFor/waitForReady/waitForLoadComplete/extractText/screenshot/navigate/scrollIntoView/resolveNode/getBbox）**原样保留**（它们已是纯 CDP）。
8. `CdpResult` 接口随之迁入（含 `code?`）。
9. 不要 module-level singleton（SDK 由调用方 new 并注入适配）。

> `logger`：SDK 不应依赖 Electron logger。改为构造可选注入或简单 `console`——本任务用最小改动：把 `logger.info/debug/warn` 换成接受一个可选 `logger?` 或直接删诊断日志。**最简：** 在 controller.ts 顶部加 `const logger = { info(){}, debug(){}, warn(){} }` 占位（诊断日志非功能必需），Phase B/C 各宿主可注入真实 logger。若想保留，可在构造加可选 `logger` 参数，默认 no-op。

- [ ] **Step 4: 导出**

```ts
// index.ts
export { BrowserController } from "./controller"
export type { CdpResult } from "./controller"
```

- [ ] **Step 5: 跑测试 + typecheck**

Run: `cd packages/browser-sdk && npx tsx --test test/controller.test.ts && npx tsc --noEmit`
Expected: controller 测试 PASS；typecheck 通过。

- [ ] **Step 6: Commit**

```bash
git add packages/browser-sdk/src/controller.ts packages/browser-sdk/test/controller.test.ts packages/browser-sdk/src/index.ts
git commit -m "feat(browser-sdk): BrowserController 去 Electron 化(注入 transport/host + getUrl/getTitle 纯 CDP)"
```

---

## Phase B — Electron 适配 + bridge 改造（回归现状）

### Task B1: ElectronDebuggerTransport

把 `webContents.debugger` 包成 `Transport`。

**Files:**
- Create: `apps/web/electron/features/browser/electron-transport.ts`

- [ ] **Step 1: 实现**

```ts
import type { WebContents } from "electron"
import type { Transport } from "@workspace/browser-sdk"

// 用 webContents.debugger 实现 Transport。wc 由 ensureBrowser 时注入。
export class ElectronDebuggerTransport implements Transport {
  private wc: WebContents | null = null
  private msgCb: ((m: string, p: unknown, s?: string) => void) | null = null

  setWebContents(wc: WebContents): void { this.wc = wc }

  async attach(): Promise<void> {
    if (!this.wc) throw new Error("BROWSER_UNAVAILABLE")
    if (this.wc.isDestroyed()) throw new Error("BROWSER_UNAVAILABLE")
    if (!this.wc.debugger.isAttached()) this.wc.debugger.attach("1.3")
    this.wc.debugger.on("message", (_e, method, params, sessionId) => {
      this.msgCb?.(method, params, sessionId)
    })
  }
  async detach(): Promise<void> {
    if (this.wc && !this.wc.isDestroyed() && this.wc.debugger.isAttached()) {
      try { this.wc.debugger.detach() } catch { /* ignore */ }
    }
  }
  isAttached(): boolean {
    return !!this.wc && !this.wc.isDestroyed() && this.wc.debugger.isAttached()
  }
  on(_e: "message", cb: (m: string, p: unknown, s?: string) => void): void { this.msgCb = cb }
  async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isAttached() || !this.wc) throw new Error("BROWSER_UNAVAILABLE")
    return this.wc.debugger.sendCommand(method, params)
  }
}
```

- [ ] **Step 2: typecheck（apps/web）**

Run: `cd apps/web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep electron-transport || echo "no errors in electron-transport"`
Expected: 无该文件相关错误（注：apps/web 全量 tsc 有既有基线错误，只看本文件）。

- [ ] **Step 3: Commit**

```bash
git add apps/web/electron/features/browser/electron-transport.ts
git commit -m "feat(browser): ElectronDebuggerTransport(webContents.debugger 实现 Transport)"
```

---

### Task B2: ElectronHost

包 `window-controller` + 确认对话框 + flashHighlight + 会话产物路径。

**Files:**
- Create: `apps/web/electron/features/browser/electron-host.ts`

- [ ] **Step 1: 实现**（包装现有 `getBrowserController()`、`requestBrowserConfirmation`、`flashHighlight`，复用现 `handleNavigate` 的 ensureBrowser 流程）

```ts
import type { Host } from "@workspace/browser-sdk"
import { getBrowserController } from "./window-controller"
import { requestBrowserConfirmation } from "./browser-confirmation"
import { flashHighlight } from "./browser-highlight"
import { getWindowManager } from "../../core/services/window-registry"
import type { ElectronDebuggerTransport } from "./electron-transport"

// 注入 transport 以便 ensureBrowser 拿到 wc 后 setWebContents + attach。
export class ElectronHost implements Host {
  private activeConversationId: string | null = null
  constructor(private transport: ElectronDebuggerTransport) {}

  async requestConfirmation(message: string): Promise<boolean> {
    return requestBrowserConfirmation({ message })
  }
  resolveArtifactPath(nameOrPath: string): string {
    // 复用现有会话产物目录解析（$ARTIFACTS_DIR/CONVERSATION_ID）。
    // 实现：沿用 bridge 原 screenshot 落盘所用的解析逻辑（迁移时从 bridge 抽出）。
    // 占位：返回绝对路径；具体解析在迁移 screenshot action 时对齐。
    return nameOrPath
  }
  async ensureBrowser(url?: string): Promise<void> {
    // ⚠️ 必须完整搬迁现 handleNavigate(bridge 231–278)的 Electron glue，按原顺序保留以下步骤：
    //   1. notifyRequestOpen(url, conversationId)  —— main.webContents.send("browser:request-open", ...)
    //   2. await delay(120)                        —— 让渲染层 settle
    //   3. let wc = await waitForBrowserWebContents(5000)  —— 轮询拿已存在的 view
    //   4. if (!wc) { ctrl.open(url); wc = await ctrl.prepareViewportForBridge() }  —— 离屏兜底创建
    //   5. if (!wc) throw new Error("BROWSER_UNAVAILABLE")  —— guard
    //   6. this.transport.setWebContents(wc); await this.transport.attach()
    // notifyRequestOpen / waitForBrowserWebContents 是现 bridge 的私有函数，迁移时一并搬进 ElectronHost。
    // 下面是骨架占位，实现者须补全上述 1–6 步，不可只写 open+prepare：
    const ctrl = getBrowserController()
    /* TODO 实现 1–6 步 */
    ctrl.open(url ?? "about:blank")
    const wc = await ctrl.prepareViewportForBridge()
    if (!wc) throw new Error("BROWSER_UNAVAILABLE")
    this.transport.setWebContents(wc)
    await this.transport.attach()
  }
  async close(): Promise<void> {
    await this.transport.detach()
    getBrowserController().close()
    // 必须保留：通知渲染层收起右栏（现 bridge close case 的 IPC）
    const main = getWindowManager().getMainWindow?.()
    main?.webContents.send("browser:request-close", { conversationId: this.activeConversationId ?? null })
  }
  beforeInteraction(): void { getBrowserController().setVisibilitySuppressed(true) }
  afterClick(refOrSelector: string): void {
    const wc = getBrowserController().getBrowserWebContents()
    if (wc) flashHighlight(wc, refOrSelector)
  }
  setActiveSession(id: string): void { this.activeConversationId = id; getBrowserController().setActiveConversationId(id) }
}
```

> 实现者注意:`ensureBrowser` 是把现有 `handleNavigate`(bridge 231–278)的 Electron glue 搬过来。**保持原有行为**(IPC request-open、5s viewport 等待、离屏兜底)。导航本身(`Page.navigate`)归 SDK `controller.navigate`,不要在这里 `wc.loadURL`——除非 E2E 发现 `Page.navigate` 在 Electron 下行为与 `loadURL` 有差异(url-change IPC 等),那时回退保留 `loadURL` 于 ensureBrowser 并跳过 controller.navigate。**Task B4 的 E2E 验证这点。**

- [ ] **Step 2: Commit**

```bash
git add apps/web/electron/features/browser/electron-host.ts
git commit -m "feat(browser): ElectronHost(包 window-controller/确认/高亮/会话/产物)"
```

---

### Task B3: createBridge 抽进 SDK

把 `browser-http-bridge.ts` 的 action 分发抽成 SDK 通用 `createBridge(controller, host)`，宿主特有调用换成 `host.*`。

**Files:**
- Create: `packages/browser-sdk/src/bridge.ts`
- Modify: `packages/browser-sdk/src/index.ts`

- [ ] **Step 1: 实现 createBridge**

把 `handleBrowserRequest` 的 switch（snapshot/click/fill/select/press/scroll/wait/extract-text/screenshot/get-url/get-title/get-value/get-attribute/navigate/close）搬进 SDK，规则：
- 所有 `dbg.<method>()` → `controller.<method>()`。
- `navigate` action → `await host.ensureBrowser(url)` 然后 `controller.navigate(url)`；`host.setActiveSession?.(convId)`。
- `click --confirm` → `host.requestConfirmation(msg)`；确认期 `host.beforeInteraction?.()`；点击后 `host.afterClick?.(ref)`。
- `get-url`/`get-title` → `controller.getUrl()`/`controller.getTitle()`（已纯 CDP，不再走 wc）。
- `screenshot` → `controller.screenshot()` **只返回 base64**（与现状一致；**写盘由 CLI `index.js` 完成，bridge 不写盘**，否则双写）。`host.resolveArtifactPath` 接口保留备未来用，标准 screenshot action 不触发它。
- `health` → **留宿主侧**：`createBridge(controller, host, opts)` 接受可选 `opts.health?: () => Promise<unknown>`；Electron 侧注入（用 window-controller 的 wc 探活 url/title），独立侧返回 daemon/transport 状态。bridge 的 health 路由调它，SDK 不直接碰 wc。
- `close` → `host.close()`。
- `errorCode` 映射函数一并迁入。
- `createBridge` 返回配置好的 `http.Server`（`startBrowserHttpBridge` 的 createServer/listenWithRetry 逻辑参数化 port）。

> 这是 Phase B 工作量最大的一步。**逐 action 对照** `browser-http-bridge.ts` 搬迁,保持请求/响应 JSON 形状不变(CLI 不感知)。

- [ ] **Step 2: 导出 + typecheck**

```ts
// index.ts
export { createBridge } from "./bridge"
```
Run: `cd packages/browser-sdk && npx tsc --noEmit`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add packages/browser-sdk/src/bridge.ts packages/browser-sdk/src/index.ts
git commit -m "feat(browser-sdk): createBridge(通用 action 分发,宿主调用走 Host)"
```

---

### Task B4: apps/web 改用 SDK + Electron 回归

让 `browser-http-bridge.ts` 改为组装 SDK：new ElectronDebuggerTransport → ElectronHost → BrowserController → createBridge。删除迁走的重复代码。

**Files:**
- Modify: `apps/web/electron/features/browser/browser-http-bridge.ts`
- Modify: `apps/web/electron/features/browser/browser-debugger-controller.ts`（删除——逻辑已迁入 SDK；若有其他引用先改）
- Delete: `apps/web/electron/features/browser/ax-tree.ts` / `ax-tree.test.ts` / `frame-tree.ts` / `frame-tree.test.ts`（已迁 SDK）
- Modify: 引用 `getBrowserDebuggerController`/`buildRefs` 等的其它文件改为从 SDK 导入或经新 bridge

- [ ] **Step 1: 重写 browser-http-bridge.ts 的 `startBrowserHttpBridge`**

```ts
import { BrowserController, createBridge } from "@workspace/browser-sdk"
import { ElectronDebuggerTransport } from "./electron-transport"
import { ElectronHost } from "./electron-host"

export function startBrowserHttpBridge(port = 34555): http.Server {
  const transport = new ElectronDebuggerTransport()
  const host = new ElectronHost(transport)
  const controller = new BrowserController(transport)  // controller 只需 transport；host 给 createBridge
  return createBridge(controller, host, { port })
}
```
删除已迁入 SDK 的 action switch / handleNavigate / handleHealth / helper（保留 Electron 侧仍需的；health 若留 Electron 侧则在 createBridge 暴露 host.health 钩子或 bridge option）。

- [ ] **Step 2: 删除 browser-debugger-controller.ts + 已迁移的 ax-tree/frame-tree（及其测试）**，并修正所有 import（grep `getBrowserDebuggerController`、`from "./ax-tree"`、`from "./browser-debugger-controller"` 全仓改为 SDK 或经 bridge）。

Run: `cd /d/code/company/digital-employe-client-web-main && grep -rn "browser-debugger-controller\|features/browser/ax-tree\|features/browser/frame-tree" apps/web/electron || echo "no dangling imports"`
Expected: 无悬空引用。

- [ ] **Step 3: 构建 + 手动 GUI E2E（关键回归）**

Run: `pnpm --filter web build:app`（或 `pnpm --filter web dev:app` 手测）
**手动 E2E（Electron 后端行为必须与改造前一致）:**
- open 网页 → snapshot → click/fill/select/press/scroll/get → close 全部正常
- `--confirm` 弹原生对话框、确认期隐藏 view
- 同源 iframe snapshot 仍含 @eN
- **navigate 用 `Page.navigate` 后**：url-change/标题/右栏布局正常（若异常 → 按 Task B2 注记回退 loadURL）

- [ ] **Step 4: Commit**

```bash
git add apps/web/electron/features/browser/browser-http-bridge.ts
git rm apps/web/electron/features/browser/browser-debugger-controller.ts apps/web/electron/features/browser/ax-tree.ts apps/web/electron/features/browser/ax-tree.test.ts apps/web/electron/features/browser/frame-tree.ts apps/web/electron/features/browser/frame-tree.test.ts
# + 任何改了 import 的文件，逐一显式 add
git commit -m "refactor(browser): Electron 后端改用 @workspace/browser-sdk(行为回归不变)"
```

---

## Phase C — 独立 daemon

### Task C1: `@workspace/browserctl-daemon` 包骨架 + 依赖

**Files:**
- Create: `packages/browserctl-daemon/package.json`
- Create: `packages/browserctl-daemon/tsconfig.json`
- Create: `packages/browserctl-daemon/src/index.ts`（占位）

- [ ] **Step 1: package.json**（依赖 SDK + chrome-launcher + chrome-remote-interface）

```json
{
  "name": "@workspace/browserctl-daemon",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "browserctl-daemon": "./src/index.ts" },
  "scripts": { "test": "node --import tsx --test test/*.test.ts", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@workspace/browser-sdk": "workspace:*",
    "chrome-launcher": "^1.1.0",
    "chrome-remote-interface": "^0.33.0"
  },
  "devDependencies": { "tsx": "^4.0.0", "typescript": "^5.0.0", "@types/chrome-remote-interface": "^0.31.0" }
}
```

- [ ] **Step 2: tsconfig.json**（复制 SDK 的）。
- [ ] **Step 3: 占位 index.ts** `export {}`。
- [ ] **Step 4:** `pnpm install`，确认依赖装上。
- [ ] **Step 5: Commit**

```bash
git add packages/browserctl-daemon/package.json packages/browserctl-daemon/tsconfig.json packages/browserctl-daemon/src/index.ts
git commit -m "feat(browserctl-daemon): 包骨架 + chrome-launcher/chrome-remote-interface 依赖"
```

---

### Task C2: ChromeCdpTransport

用 `chrome-remote-interface` 实现 `Transport`（launch 与 connect 共用）。

**Files:**
- Create: `packages/browserctl-daemon/src/chrome-transport.ts`
- Create: `packages/browserctl-daemon/test/chrome-transport.test.ts`

- [ ] **Step 1: 实现**

```ts
import CDP from "chrome-remote-interface"
import type { Transport } from "@workspace/browser-sdk"

export class ChromeCdpTransport implements Transport {
  private client: CDP.Client | null = null
  private msgCb: ((m: string, p: unknown, s?: string) => void) | null = null
  constructor(private opts: { port: number; target?: string }) {}

  async attach(): Promise<void> {
    this.client = await CDP({ port: this.opts.port })
    // 监听所有 CDP 事件 → 转发给 on("message")
    this.client.on("event", (msg: { method: string; params: unknown; sessionId?: string }) => {
      this.msgCb?.(msg.method, msg.params, msg.sessionId)
    })
  }
  async detach(): Promise<void> { await this.client?.close(); this.client = null }
  isAttached(): boolean { return !!this.client }
  on(_e: "message", cb: (m: string, p: unknown, s?: string) => void): void { this.msgCb = cb }
  async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) throw new Error("BROWSER_UNAVAILABLE")
    return this.client.send(method as never, params as never)
  }
}
```

- [ ] **Step 2: 测试（mock 或 skip-if-no-chrome）**——CDP 连接需真实浏览器，故本单测只验证 isAttached 初值/detach 幂等等无需连接的行为；真实连接在 Phase D 集成测试覆盖。

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { ChromeCdpTransport } from "../src/chrome-transport"

test("未 attach 时 isAttached=false，sendCommand 抛 BROWSER_UNAVAILABLE", async () => {
  const t = new ChromeCdpTransport({ port: 0 })
  assert.equal(t.isAttached(), false)
  await assert.rejects(() => t.sendCommand("Page.enable"), /BROWSER_UNAVAILABLE/)
})
```

- [ ] **Step 3: 跑测试 + typecheck**

Run: `cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts && npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/browserctl-daemon/src/chrome-transport.ts packages/browserctl-daemon/test/chrome-transport.test.ts
git commit -m "feat(browserctl-daemon): ChromeCdpTransport(chrome-remote-interface 实现 Transport)"
```

---

### Task C3: StandaloneHost

**Files:**
- Create: `packages/browserctl-daemon/src/standalone-host.ts`
- Create: `packages/browserctl-daemon/test/standalone-host.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { StandaloneHost } from "../src/standalone-host"

test("requestConfirmation 放行 → true（无人值守，审计日志）", async () => {
  const logs: string[] = []
  const host = new StandaloneHost({ logger: (m) => logs.push(m) })
  assert.equal(await host.requestConfirmation("提交申请？"), true)
  assert.ok(logs.some((l) => l.includes("提交申请")))
})

test("resolveArtifactPath 相对名 → cwd 绝对路径", () => {
  const host = new StandaloneHost({})
  assert.equal(host.resolveArtifactPath("shot.png"), path.resolve(process.cwd(), "shot.png"))
})
```

- [ ] **Step 2: 跑失败** → **Step 3: 实现**

```ts
import path from "node:path"
import type { Host } from "@workspace/browser-sdk"

export class StandaloneHost implements Host {
  private log: (m: string) => void
  constructor(private opts: { logger?: (m: string) => void; attach?: () => Promise<void> }) {
    this.log = opts.logger ?? ((m) => console.error(m))
  }
  async requestConfirmation(message: string): Promise<boolean> {
    this.log(`[browserctl] 独立后端放行敏感动作(--confirm): ${message}`)
    return true
  }
  resolveArtifactPath(nameOrPath: string): string {
    return path.isAbsolute(nameOrPath) ? nameOrPath : path.resolve(process.cwd(), nameOrPath)
  }
  async ensureBrowser(): Promise<void> { await this.opts.attach?.() } // 浏览器已由 daemon launch+attach
  async close(): Promise<void> {}
  // beforeInteraction/afterClick/setActiveSession 省略(可选,no-op)
}
```

- [ ] **Step 4: 跑测试 + typecheck** → **Step 5: Commit**

```bash
git add packages/browserctl-daemon/src/standalone-host.ts packages/browserctl-daemon/test/standalone-host.test.ts
git commit -m "feat(browserctl-daemon): StandaloneHost(confirm 放行+日志/cwd 产物/no-op)"
```

---

### Task C4: daemon 入口

解析 args → chrome-launcher launch（或 --cdp connect）→ 组装 SDK → createBridge listen。

**Files:**
- Modify: `packages/browserctl-daemon/src/index.ts`

- [ ] **Step 1: 实现入口**

```ts
import * as ChromeLauncher from "chrome-launcher"
import { BrowserController, createBridge } from "@workspace/browser-sdk"
import { ChromeCdpTransport } from "./chrome-transport"
import { StandaloneHost } from "./standalone-host"

// 解析 --browser/--headless/--user-data-dir/--port/--executable/--cdp（简单 argv 解析）
async function main() {
  const args = parseArgs(process.argv.slice(2)) // 自写极简解析
  let port: number
  if (args.cdp) {
    port = Number(args.cdp) // connect 已运行实例
  } else {
    const chrome = await ChromeLauncher.launch({
      chromeFlags: args.headless ? ["--headless=new"] : [],
      userDataDir: args.userDataDir ?? defaultProfileDir(args.browser),
      chromePath: args.executable, // 未指定则 chrome-launcher 自动探测；Edge 需显式
    })
    port = chrome.port
  }
  const transport = new ChromeCdpTransport({ port })
  await transport.attach()
  const host = new StandaloneHost({ attach: async () => {} })
  const controller = new BrowserController(transport)  // controller 只需 transport；host 给 createBridge
  const server = createBridge(controller, host, { port: args.port ?? 34555 })
  console.error(`[browserctl-daemon] listening on ${args.port ?? 34555}, driving Chrome :${port}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

> Edge：`--browser edge` 时 `chromePath` 用系统 Edge 路径（spike 探测，或要求 `--executable`）。`defaultProfileDir(browser)` = `path.join(os.homedir(), ".browserctl", "profile-" + browser)`（**用 `os.homedir()`，勿用 `~`**——Windows 下 `~` 不展开）。`parseArgs` 自写极简（无三方）。

- [ ] **Step 2: typecheck + 冒烟（手动）**

Run: `cd packages/browserctl-daemon && npx tsc --noEmit`
Expected: 通过。手动冒烟在 Phase D 集成测试覆盖。

- [ ] **Step 3: Commit**

```bash
git add packages/browserctl-daemon/src/index.ts
git commit -m "feat(browserctl-daemon): 入口(launch 持久 profile / --cdp connect → createBridge)"
```

---

## Phase D — Chrome 集成测试（自动化 E2E）

### Task D1: headless Chrome 端到端集成测试

launch headless Chrome，真实跑命令序列，验证双后端命令逻辑在真实 CDP 下正确——把之前手动 E2E 自动化。

**Files:**
- Create: `packages/browserctl-daemon/test/integration.test.ts`
- Create: `packages/browserctl-daemon/test/fixtures/iframe-page.html`（主页内嵌同源 iframe + 表单）

- [ ] **Step 1: fixture 页**：一个本地 HTML，含一个 `<input id="q">`、一个 `<button>`、一个 `<select>`，再内嵌一个**同源** iframe（`srcdoc` 或同目录文件）里放一个 `<input>`。

- [ ] **Step 2: 集成测试**（launch headless chrome → ChromeCdpTransport → BrowserController + StandaloneHost，直接调 controller，不经 HTTP）

```ts
import test from "node:test"
import assert from "node:assert/strict"
import * as ChromeLauncher from "chrome-launcher"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { BrowserController } from "@workspace/browser-sdk"
import { ChromeCdpTransport } from "../src/chrome-transport"
import { StandaloneHost } from "../src/standalone-host"

test("headless Chrome: open→snapshot→fill→get value（含同源 iframe）", async (t) => {
  let chrome
  try { chrome = await ChromeLauncher.launch({ chromeFlags: ["--headless=new"] }) }
  catch { t.skip("无 Chrome 可用"); return }
  const transport = new ChromeCdpTransport({ port: chrome.port })
  await transport.attach()
  const c = new BrowserController(transport)  // 集成测试直接调 controller，不经 bridge/host
  try {
    const url = pathToFileURL(path.resolve(import.meta.dirname, "fixtures/iframe-page.html")).href
    await transport.sendCommand("Page.enable")
    await c.navigate(url)
    const snap = await c.snapshot(200)
    assert.equal(snap.ok, true)
    // 主页 input + iframe 内 input 都应出现在 @eN
    const refs = (snap.data as { refs: Array<{ role: string }> }).refs
    assert.ok(refs.length > 0)
    // 找一个 textbox @eN 填值并校验
    // （按 fixture 结构定位，fill 后 get value 校验）
  } finally {
    await transport.detach()
    await chrome.kill()
  }
})
```

完善断言：fill 主页 input → getValue 校验；snapshot 含 iframe 内控件（验证 Phase-iframe 逻辑在独立 Chrome 下也工作）；click button；select。

- [ ] **Step 3: 跑集成测试**

Run: `cd packages/browserctl-daemon && npx tsx --test test/integration.test.ts`
Expected: PASS（或在无 Chrome 环境 skip）。

- [ ] **Step 4: Commit**

```bash
git add packages/browserctl-daemon/test/integration.test.ts packages/browserctl-daemon/test/fixtures/iframe-page.html
git commit -m "test(browserctl-daemon): headless Chrome 端到端集成(open/snapshot/fill/iframe 自动化 E2E)"
```

---

## 收尾

Phase A–D 由子代理逐 task 完成、各自 review 通过后：
1. SDK + daemon 全测试：`cd packages/browser-sdk && npx tsx --test test/*.test.ts` && `cd packages/browserctl-daemon && npx tsx --test test/*.test.ts`。
2. **Electron 手动 GUI E2E**（Task B4）确认现状回归。
3. **独立 daemon 冒烟**：`node packages/browserctl-daemon/src/index.ts --browser chrome` 起 daemon，另开终端 `BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl open https://example.com && browserctl snapshot`。
4. 走 superpowers:finishing-a-development-branch 合并回 dev。

**后续子项目（非本计划）:** P1–P3 命令对齐 agent-browser；OA 业务自动化封装成 skill；CLI 文档补独立 daemon 用法。

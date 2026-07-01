# Browser Runtime 按会话归属摊开 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `browser-runtime`（browserctl）触发的浏览器面板只在「发起调用的那个会话 == 当前前台会话」时摊开，消除「总管被委派员工的浏览器任务摊错到总管界面」的 bug。

**Architecture:** 现状是单例、单 session（`"default"`）的浏览器桥——任何会话的 `browserctl navigate` 都无条件把唯一的 `WebContentsView` 拍到当前前台窗口。本方案让发起方会话 id（`CONVERSATION_ID`，后端 shell env 里早已按会话注入）贯穿全链路：browserctl 把它作为 bridge 的 session 段上报 → bridge 在 `request-open`/confirmation 事件里带上 `conversationId` → 前端只在 `selectedConversationId === conversationId` 时才 `openBrowser`，否则只记录「该会话有浏览器在跑」的状态、不渲染。采用「逻辑多会话 + 单活跃 WebContentsView」：同一时刻只渲染前台会话的浏览器，切会话时重用同一个 view 重载 URL（非前台会话页面不保活，登录态走 partition 仍在）。非前台会话静默——不摊任何面板、不显示浮标。

**Tech Stack:** Node.js（browserctl CLI，`packages/browserctl`）、Python（`SkillAwareShellBackend` env 注入）、Electron 主进程 TS（`browser-http-bridge.ts` / `window-controller.ts` / `preload-bridge.ts`）、React + Zustand 前端（`browser-store.ts` / `browser-confirmation-host.tsx`）。

**关键事实（已查证）：**
- `SkillAwareShellBackend` 已把发起会话 id 注入 shell env `CONVERSATION_ID`（[skill_shell_backend.py:180-181](apps/server/src/service/skill_shell_backend.py:180)）。委派员工任务时用的是**员工执行会话的新 conv_id**（[execution.py:330-447](apps/server/src/service/agent/orchestrator/execution.py:439)），与总管会话 id 天然不同——这是区分「谁在调用」的可靠依据。
- browserctl 已能读 `CONVERSATION_ID`（[index.js:290](packages/browserctl/src/index.js:290)）、`BROWSER_RUNTIME_SESSION` 可覆盖 session 段（[index.js:11](packages/browserctl/src/index.js:11)），但目前所有请求都打死的 `"default"` session。
- bridge 路由用正则解析 `/internal/browser/<sessionId>/<action>`（[browser-http-bridge.ts:97](apps/web/electron/features/browser/browser-http-bridge.ts:97)），`ensureBrowserSession` 只放行 `"default"`（[browser-http-bridge.ts:109-111](apps/web/electron/features/browser/browser-http-bridge.ts:109)）。
- 前端「当前前台会话 id」= `useChatStore.getState().selectedConversationId`（`string | number | null`，[chat-store.ts:21](apps/web/src/stores/chat-store.ts:21)）。
- 前端浏览器面板入口只有一个：`onRequestOpen` → `openBrowser`（[browser-confirmation-host.tsx:39-41](apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx:39)）；`setWindowOpenHandler` 里 target=_blank 弹新窗也会 `browser:request-open`（[window-controller.ts:294-306](apps/web/electron/features/browser/window-controller.ts:300)）。

**设计原则：向后兼容 + 渐进。** browserctl 不带 `CONVERSATION_ID` 时 fallback 到 `"default"`（脱离桌面端单独调试 CLI 的场景）；bridge 收到 `default` 或任意非数字 session 时维持「无条件摊开」旧行为（即仅当 session 是真实数字 conv_id 才走归属判断），保证未重建的 browserctl / 旧调试路径不被打断。

---

## File Structure

| 文件 | 改动职责 |
|------|---------|
| `packages/browserctl/src/index.js` | session 段从写死 `"default"` 改为「`BROWSER_RUNTIME_SESSION` > `CONVERSATION_ID` > `"default"`」 |
| `packages/browserctl/test/index.test.js` | 新增 session 解析测试 |
| `apps/web/electron/features/browser/browser-http-bridge.ts` | 解析 session 段为发起 conv_id；`notifyRequestOpen` / confirmation / request-close 事件带上 `conversationId`；`ensureBrowserSession` 放行数字 session |
| `apps/web/electron/features/browser/window-controller.ts` | `setWindowOpenHandler` 的 `request-open` 带当前活跃 conv_id（来自最近一次 navigate） |
| `apps/web/electron/features/browser/preload-bridge.ts` | `BrowserRequestOpenEvent` 类型补 `conversationId?` |
| `apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx` | `onRequestOpen` 按归属判断：前台会话才 `openBrowser`，否则只记后台状态 |
| `apps/web/src/stores/browser-store.ts` | 新增 `backgroundSessions: Set<string>` + `noteBackgroundOpen` / `adoptForeground` / `clearBackground`，切会话时 adopt |

---

## Task 1: browserctl 用 CONVERSATION_ID 作 session 段

**Files:**
- Modify: `packages/browserctl/src/index.js:11`
- Test: `packages/browserctl/test/index.test.js`

把 bridge 请求路径里的 session 段从写死 `DEFAULT_SESSION`（恒 `"default"`）改为运行时解析「`BROWSER_RUNTIME_SESSION` 显式覆盖 > `CONVERSATION_ID` > `"default"`」。这样桌面端跑的每个会话（含委派员工执行会话）自动带上自己的 conv_id，脱离桌面端单独调 CLI 时仍回落 `"default"`。

- [ ] **Step 1: 写失败测试**

在 `packages/browserctl/test/index.test.js` 末尾追加（先补一个导出的纯函数 `resolveSession`，再测它；集成层测 navigate 路径段）：

```javascript
import {
  parseFlags,
  normalizeUrl,
  formatSnapshotText,
  resolveArtifactRealPath,
  resolveSession,
} from "../src/index.js"

test("resolveSession: 显式 SESSION 优先，其次 CONVERSATION_ID，否则 default", () => {
  assert.equal(
    resolveSession({ BROWSER_RUNTIME_SESSION: "abc", CONVERSATION_ID: "42" }),
    "abc"
  )
  assert.equal(resolveSession({ CONVERSATION_ID: "42" }), "42")
  assert.equal(resolveSession({ CONVERSATION_ID: "" }), "default")
  assert.equal(resolveSession({}), "default")
})

test("navigate 把 CONVERSATION_ID 作为 bridge 路径 session 段", async () => {
  let reqUrl
  const srv = await startServer((req, res) => {
    reqUrl = req.url
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open", "example.com"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv), CONVERSATION_ID: "77" },
    })
    assert.ok(
      reqUrl.startsWith("/internal/browser/77/navigate"),
      `expected session segment 77, got ${reqUrl}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("navigate 无 CONVERSATION_ID 时回落 default session 段", async () => {
  let reqUrl
  const srv = await startServer((req, res) => {
    reqUrl = req.url
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open", "example.com"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    assert.ok(
      reqUrl.startsWith("/internal/browser/default/navigate"),
      `expected default segment, got ${reqUrl}`
    )
  } finally {
    await closeServer(srv)
  }
})
```

> 注意：`runCli` 用 `{ ...process.env, ...env }` 合并环境（[index.test.js:163](packages/browserctl/test/index.test.js:163)）。若运行测试的 shell 自身设了 `CONVERSATION_ID`，「回落 default」用例会被污染。在该用例的 `env` 里显式清空：`CONVERSATION_ID: ""`、`BROWSER_RUNTIME_SESSION: ""`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @workspace/browserctl test`
Expected: FAIL — `resolveSession is not exported` / navigate 用例拿到 `/internal/browser/default/...` 而非 `/77/...`

- [ ] **Step 3: 实现**

在 `packages/browserctl/src/index.js` 顶部常量区，把第 11 行的 `DEFAULT_SESSION` 改为运行时解析函数，并替换所有引用点。

把第 11 行：
```javascript
const DEFAULT_SESSION = process.env.BROWSER_RUNTIME_SESSION || "default"
```
改为：
```javascript
// 会话归属：显式 BROWSER_RUNTIME_SESSION 覆盖 > 发起会话 CONVERSATION_ID（桌面端
// 每会话 shell 已注入）> "default"（脱离桌面端单独调 CLI 时回落）。bridge 据此把
// 浏览器面板只摊给发起会话，不再无条件拍到当前前台窗口。
export function resolveSession(env = process.env) {
  const explicit = (env.BROWSER_RUNTIME_SESSION || "").trim()
  if (explicit) return explicit
  const conv = (env.CONVERSATION_ID || "").trim()
  if (conv) return conv
  return "default"
}
```

`usage()` 里第 37 行用到 `DEFAULT_SESSION` 展示默认值，改为运行时调用：
```javascript
  BROWSER_RUNTIME_SESSION     default ${resolveSession()}`
```

`postAction` 里第 251 行用 `DEFAULT_SESSION` 拼路径，改为每次调用时解析（确保读到最新 env）：
```javascript
function postAction(action, payload) {
  return requestJson(
    "POST",
    `/internal/browser/${encodeURIComponent(resolveSession())}/${action}`,
    payload
  )
}
```

> `open-artifact` 的 `CONVERSATION_ID` 读取逻辑（[index.js:290](packages/browserctl/src/index.js:290)）保持不变——它读的是同一个 env，与 session 段解析互不冲突。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @workspace/browserctl test`
Expected: PASS（含原有全部用例 + 3 个新用例）

- [ ] **Step 5: 提交**

```bash
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git commit -m "feat(browserctl): session 段用发起会话 CONVERSATION_ID 替代写死 default

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: bridge 解析发起会话并随事件下发 conversationId

**Files:**
- Modify: `apps/web/electron/features/browser/browser-http-bridge.ts`

bridge 把 URL 里的 session 段（现在可能是数字 conv_id）解析出来，在 `notifyRequestOpen`、confirmation 请求、`request-close` 三处把 `conversationId` 一并发给 renderer；`ensureBrowserSession` 放行数字 session（不再只认 `"default"`）。`navigate` handler 把发起 conv_id 透传给 `notifyRequestOpen`，并记到 controller 上供 `setWindowOpenHandler` 复用（Task 3）。

> 本仓库 Electron 侧无单测框架（`packages/browserctl` 有 node:test，但 `apps/web/electron` 没有）。本 Task 与 Task 3-5 用「编译 + 类型检查 + 手动验收」把关，不写自动化测试。验收脚本见 Task 6。

- [ ] **Step 1: parsePath 已返回 sessionId，新增「是否真实会话」判定**

在 `browser-http-bridge.ts` 的 `ensureBrowserSession`（第 109-111 行）下方加一个判定函数，并放宽 `ensureBrowserSession`：

```typescript
function ensureBrowserSession(sessionId: string): boolean {
  // 放行 "default"（脱离桌面端调试 / 未重建的 browserctl）与任意非空 session 段。
  // 真实会话归属判断交给前端按 conversationId 比对，bridge 只负责把 id 透传下去。
  return sessionId.length > 0
}

// 真实会话 = 纯数字 conv_id（前端据此判归属）。"default" / 非数字 → 视为「无归属」，
// 维持旧的「无条件摊开当前前台」行为，保证旧调试路径不被打断。
function sessionToConversationId(sessionId: string): string | null {
  return /^\d+$/.test(sessionId) ? sessionId : null
}
```

- [ ] **Step 2: notifyRequestOpen 带 conversationId**

把 `notifyRequestOpen`（第 102-107 行）改为可带 conversationId：

```typescript
function notifyRequestOpen(url: string, conversationId: string | null): void {
  const main = getWindowManager().get("main")
  if (main && !main.isDestroyed()) {
    main.webContents.send("browser:request-open", { url, conversationId })
  }
}
```

- [ ] **Step 3: handleBrowserRequest 把发起会话 id 透传，并记到 controller**

在 `handleBrowserRequest` 解析出 `{ sessionId, action }`（第 293 行）后，算出 conv_id 并在进入 `navigate` 分支时透传。把 navigate 分支（第 316-324 行）改为：

```typescript
      case "navigate": {
        const url = String(body.url ?? "")
        if (!url) {
          reply(res, 400, { ok: false, error: "url required" })
          return
        }
        const convId = sessionToConversationId(sessionId)
        // 记下当前活跃会话，供 setWindowOpenHandler（页面内 _blank 弹窗）复用归属
        getBrowserController().setActiveConversationId(convId)
        await handleNavigate(res, url, convId)
        return
      }
```

并把 `handleNavigate` 签名（第 215-218 行）与内部的 `notifyRequestOpen` 调用（第 221 行）改为：

```typescript
async function handleNavigate(
  res: ServerResponse,
  url: string,
  conversationId: string | null
): Promise<void> {
  const controller = getBrowserController()

  notifyRequestOpen(url, conversationId)
  await delay(120)
  // ……以下不变
```

- [ ] **Step 4: confirmation 与 request-close 也带 conversationId**

`click` 分支里需要确认时（第 350-374 行）目前调 `requestBrowserConfirmation`。该函数最终触发 renderer 的 `browser:confirmation-request`。为让前端确认弹窗也能判归属（非前台会话的确认不该弹在总管界面），把当前 `sessionId` 对应的 conv_id 传进去。在 click 分支顶部取一次 conv_id：

```typescript
      case "click": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const clickConvId = sessionToConversationId(sessionId)
        const wc = dbg.getWebContents()
        // ……refOrSelector / confirmationRequired 不变
```

并把 `requestBrowserConfirmation({...})` 调用补上 `conversationId: clickConvId`：

```typescript
            approved = await requestBrowserConfirmation({
              message: confirmationMessage,
              refOrSelector,
              screenshotBase64: shot.ok ? shot.data?.base64 : undefined,
              conversationId: clickConvId,
            })
```

> `requestBrowserConfirmation` 定义在 `browser-confirmation.ts`。需打开该文件，给其入参类型补 `conversationId?: string | null`，并在它 `main.webContents.send("browser:confirmation-request", ...)` 的 payload 里带上 `conversationId`。若该文件没有显式 payload 类型，照现有字段平铺加一个即可。

`close` 分支（第 452-462 行）的 `browser:request-close` 也带上 conv_id（让前端只 reset 对应会话状态）：

```typescript
      case "close": {
        getBrowserDebuggerController().detach()
        getBrowserController().close()
        const main = getWindowManager().get("main")
        if (main && !main.isDestroyed()) {
          const closeConvId = sessionToConversationId(sessionId)
          main.webContents.send("browser:request-close", {
            conversationId: closeConvId,
          })
        }
        reply(res, 200, { ok: true, data: { closed: true } })
        return
      }
```

- [ ] **Step 5: 类型检查**

Run: `pnpm typecheck --filter=web`
Expected: PASS（`setActiveConversationId` 在 Task 3 才加到 controller —— 若先单独跑会报 controller 无此方法。**本 Task 与 Task 3 是同一编译单元，建议连做 Task 3 再一起 typecheck/commit**。）

- [ ] **Step 6: 提交（与 Task 3 合并提交，见 Task 3 Step 4）**

---

## Task 3: window-controller 记录活跃会话并用于 _blank 弹窗

**Files:**
- Modify: `apps/web/electron/features/browser/window-controller.ts`

`BrowserWindowController` 新增 `activeConversationId` 字段 + setter。`setWindowOpenHandler`（页面内 `target=_blank` / `window.open` 触发的 `browser:request-open`，第 294-306 行）复用这个 id，使页面内弹出的新窗口也归属到正确会话。

- [ ] **Step 1: 加字段与 setter**

在类字段区（第 76 行 `visibilitySuppressed` 后）加：

```typescript
  // 最近一次 navigate 的发起会话 id（数字 conv_id 或 null）。页面内 _blank 弹窗
  // 走 setWindowOpenHandler 的 request-open 时复用它，使弹窗归属到同一会话。
  private activeConversationId: string | null = null
```

在 `getBrowserWebContents()`（第 262 行）附近加 public 方法：

```typescript
  setActiveConversationId(conversationId: string | null): void {
    this.activeConversationId = conversationId
  }
```

- [ ] **Step 2: setWindowOpenHandler 带上 conversationId**

把第 294-306 行的 handler 改为：

```typescript
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      if (
        targetUrl.startsWith("https:") ||
        targetUrl.startsWith("http:")
      ) {
        if (!main.isDestroyed()) {
          main.webContents.send("browser:request-open", {
            url: targetUrl,
            conversationId: this.activeConversationId,
          })
        }
      }
      return { action: "deny" }
    })
```

- [ ] **Step 3: 类型检查**

Run: `pnpm typecheck --filter=web`
Expected: PASS（Task 2 引用的 `setActiveConversationId` 现已存在）

- [ ] **Step 4: 提交 Task 2 + Task 3**

```bash
git add apps/web/electron/features/browser/browser-http-bridge.ts \
        apps/web/electron/features/browser/browser-confirmation.ts \
        apps/web/electron/features/browser/window-controller.ts
git commit -m "feat(browser): bridge/controller 把发起会话 conversationId 随 IPC 事件下发

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: preload 类型补 conversationId

**Files:**
- Modify: `apps/web/electron/features/browser/preload-bridge.ts`

`BrowserRequestOpenEvent` 类型加 `conversationId?: string | null`，让 renderer 拿到归属字段时类型安全。confirmation 与 close 的事件类型同步补。

- [ ] **Step 1: 改类型**

打开 `preload-bridge.ts`，找到 `BrowserRequestOpenEvent` 定义（搜 `BrowserRequestOpenEvent`），加字段：

```typescript
export interface BrowserRequestOpenEvent {
  url: string
  conversationId?: string | null
}
```

找到 confirmation 请求事件类型（搜 `BrowserConfirmationRequestEvent`），加 `conversationId?: string | null`。

`onRequestClose` 目前回调无参（[preload-bridge.ts:63](apps/web/electron/features/browser/preload-bridge.ts:63)，`callback: () => void`）。改为透传 payload：

```typescript
  onRequestClose: (
    callback: (data: { conversationId?: string | null }) => void
  ) =>
    onChannel("browser:request-close", (data) => {
      callback((data ?? {}) as { conversationId?: string | null })
    }),
```

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck --filter=web`
Expected: 可能报 `browser-confirmation-host.tsx` 里 `onRequestClose` 回调签名不匹配（旧的 `() =>`）——这是预期的，Task 5 修复。先只确认 preload 本身无错；若想隔离，可临时把 host 的 close 回调改成 `(_data) =>` 占位，Task 5 再正式处理。

- [ ] **Step 3: 提交**

```bash
git add apps/web/electron/features/browser/preload-bridge.ts
git commit -m "feat(browser): preload 事件类型补 conversationId 归属字段

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: 前端按会话归属决定是否摊开

**Files:**
- Modify: `apps/web/src/stores/browser-store.ts`
- Modify: `apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx`

核心归属逻辑：`onRequestOpen` 收到带 `conversationId` 的事件时，比对 `useChatStore.getState().selectedConversationId`：
- **归属字段为空（`null`/`undefined`，即 `"default"` 调试路径）** → 维持旧行为，无条件 `openBrowser`。
- **归属 == 当前前台会话** → `openBrowser`（并记录 `activeBrowserConversationId`）。
- **归属 != 当前前台会话** → 静默：只把该 conv_id 记进 `backgroundSessions`，**不**摊面板、**不**显示浮标。

切会话时（监听 `selectedConversationId` 变化）：若新前台会话在 `backgroundSessions` 里，调 `adoptForeground` —— 但因为采用「单活跃视图、非前台不保活」，后台会话此前并未真正 loadURL 到 view 上，adopt 时无 URL 可恢复，故本期 adopt 仅清掉该会话的 background 标记（不主动重开）。真正重开由用户回到该会话后，员工的后续 browserctl 命令（或用户手动操作）触发——符合「非前台静默、切回不自动弹」的最小语义。

> **范围说明（按已确认决策）：** 「非前台静默」= 不弹面板、不弹浮标。这意味着非前台会话的浏览器命令在用户看不到的情况下静默执行（snapshot/click/fill 仍经 bridge 操作那个唯一的 WebContentsView）。这是「逻辑多会话 + 单活跃视图」的已知取舍：单视图同一时刻只服务一个会话，多会话并发用浏览器仍会争用同一 view。本期只解决「摊错界面」，并发争用属 Task 7（可选，见末尾）。

- [ ] **Step 1: browser-store 加后台会话状态**

在 `BrowserState` 接口（[browser-store.ts:14-48](apps/web/src/stores/browser-store.ts:14)）加字段与方法：

```typescript
interface BrowserState {
  // ……现有字段
  // 当前活跃浏览器归属的会话 id（与前台一致时才渲染）；null = 无归属/调试路径
  activeBrowserConversationId: string | null
  // 有浏览器命令在跑、但不属于当前前台会话 → 静默记录，不渲染
  backgroundSessions: Set<string>

  // ……现有方法
  noteBackgroundOpen: (conversationId: string) => void
  clearBackground: (conversationId: string) => void
  setActiveBrowserConversationId: (conversationId: string | null) => void
}
```

初始值（[browser-store.ts:69-80](apps/web/src/stores/browser-store.ts:69)）加：

```typescript
  activeBrowserConversationId: null,
  backgroundSessions: new Set<string>(),
```

实现三个方法（放在 `reset` 之前）：

```typescript
  noteBackgroundOpen: (conversationId: string) => {
    set((s) => {
      const next = new Set(s.backgroundSessions)
      next.add(conversationId)
      return { backgroundSessions: next }
    })
  },

  clearBackground: (conversationId: string) => {
    set((s) => {
      if (!s.backgroundSessions.has(conversationId)) return {}
      const next = new Set(s.backgroundSessions)
      next.delete(conversationId)
      return { backgroundSessions: next }
    })
  },

  setActiveBrowserConversationId: (conversationId: string | null) => {
    set({ activeBrowserConversationId: conversationId })
  },
```

`reset`（[browser-store.ts:208-220](apps/web/src/stores/browser-store.ts:208)）补上清空 `activeBrowserConversationId: null`（**不**清 `backgroundSessions`——其他后台会话的标记应保留）。

- [ ] **Step 2: confirmation-host 的 onRequestOpen 按归属判断**

把 `browser-confirmation-host.tsx` 的 effect（[browser-confirmation-host.tsx:29-53](apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx:29)）改为：

```typescript
  React.useEffect(() => {
    const api = getElectronApi()
    if (!api?.browser?.onConfirmationRequest) return

    const unsubRequest = api.browser.onConfirmationRequest((data) => {
      // 非前台会话的确认弹窗不弹在当前界面（否则总管会替员工的浏览器操作背确认）
      const fg = String(
        useChatStore.getState().selectedConversationId ?? ""
      )
      const owner = data.conversationId ?? null
      if (owner && fg && owner !== fg) return
      setPending(data)
    })

    const unsubOpen = api.browser.onRequestOpen?.((data) => {
      if (!data.url) return
      const owner = data.conversationId ?? null
      const fg = String(
        useChatStore.getState().selectedConversationId ?? ""
      )
      const store = useBrowserStore.getState()
      // 无归属（default/调试路径）→ 维持旧的无条件摊开
      if (!owner) {
        store.openBrowser(data.url)
        store.setActiveBrowserConversationId(null)
        return
      }
      // 归属 == 前台 → 摊开并记归属；否则静默记后台，不渲染
      if (owner === fg) {
        store.openBrowser(data.url)
        store.setActiveBrowserConversationId(owner)
        store.clearBackground(owner)
      } else {
        store.noteBackgroundOpen(owner)
      }
    })

    const unsubClose = api.browser.onRequestClose?.((data) => {
      const owner = data?.conversationId ?? null
      const store = useBrowserStore.getState()
      // 关的是后台会话 → 只清它的后台标记，不动当前界面
      if (owner) {
        const fg = String(
          useChatStore.getState().selectedConversationId ?? ""
        )
        if (owner !== fg) {
          store.clearBackground(owner)
          return
        }
      }
      store.reset()
    })

    return () => {
      unsubRequest()
      unsubOpen?.()
      unsubClose?.()
    }
  }, [openBrowser])
```

文件顶部 import 补 `useChatStore`：

```typescript
import { useChatStore } from "@/stores/chat-store"
```

（`useBrowserStore` 已 import，[browser-confirmation-host.tsx:15](apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx:15)。`openBrowser` 选择器 [browser-confirmation-host.tsx:25](apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx:25) 现在改用 `useBrowserStore.getState().openBrowser`，可保留原 selector 以维持 effect 依赖，或删掉那行并把依赖数组改 `[]`——保留更稳，effect 体内统一用 `getState()`。）

- [ ] **Step 3: 类型检查 + lint**

Run: `pnpm typecheck --filter=web && pnpm lint --filter=web`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/stores/browser-store.ts \
        apps/web/src/components/chat/right-panels/browser-confirmation-host.tsx
git commit -m "feat(browser): 浏览器面板按发起会话归属摊开，非前台静默

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 端到端手动验收

**Files:** 无（验收）

桌面端无自动化集成测试，本 Task 是必跑的人工验收清单，验证 bug 实际消失且未回归。

- [ ] **Step 1: 重建 browserctl 并完全重启桌面端**

```bash
pnpm --filter @workspace/browserctl build || true   # 若无 build 脚本则跳过，CLI 是纯 JS
```
完全退出 Electron（含托盘），`pnpm --filter web dev:app`。

- [ ] **Step 2: 复现原 bug 场景（核心验收）**

1. 给某员工分配 `browser-runtime` skill。
2. 在**总管会话**里下达一个会被委派给该员工、且任务内含网页操作（如「打开百度搜 X」）的任务。
3. 停留在总管会话界面，观察委派员工后台执行 browserctl navigate 时。

Expected: **总管界面不再摊开浏览器右栏**（修复前会摊开）。切到那个员工的执行会话，浏览器在该会话右栏正常显示。

- [ ] **Step 3: 正向回归——员工本人会话直接用浏览器**

在员工会话里直接让它跑 `browserctl open https://www.baidu.com` 流程，停在该会话界面。

Expected: 浏览器照常在当前会话右栏摊开、可 snapshot/click（即归属==前台的路径不受影响）。

- [ ] **Step 4: 调试路径回归——脱离会话 id 的裸 CLI**

仓库内手动跑（无 `CONVERSATION_ID`）：

Run: `pnpm --filter @workspace/browserctl exec browserctl open https://www.baidu.com`（或 README 第 27 行的等价命令）
Expected: 浏览器仍摊开（`default` session 走旧的无条件路径，未被打断）。

- [ ] **Step 5: 确认弹窗归属回归**

员工会话里触发一个需 `--confirm` 的 click，停在该会话界面 → 确认弹窗正常弹出；切到别的会话再触发 → 确认弹窗不弹在别的会话界面。

- [ ] **Step 6: 提交验收记录（可选）**

若过程中改了 README/文档，一并提交；否则本 Task 无产物。

---

## Task 7（可选，本期可不做）: 单活跃视图的并发争用收敛

**背景：** 「逻辑多会话 + 单活跃视图」下，多个非前台会话同时跑浏览器命令会争用同一个 `WebContentsView`（后一个 navigate 覆盖前一个的页面）。本期只解决「摊错界面」，未解决争用。

**若要做：** 在 bridge 维护「当前持有 view 的 conv_id」；当 B 会话 navigate 时若 view 正被 A 会话占用，对 B 的请求返回一个明确错误码（如 `BROWSER_BUSY`），让员工 agent 知道需排队/稍后重试，而非静默覆盖 A 的页面。这需要 browserctl 侧把 `BROWSER_BUSY` 翻译成可纠偏提示。

**判断：** 仅当实际出现「多员工并发抢浏览器」投诉再做；否则 YAGNI。

---

## Self-Review

**1. Spec coverage（对照诊断结论的三段落点）：**
- browserctl 带 conv_id → Task 1 ✓
- bridge per-session 路由 + 事件带 conv_id → Task 2/3 ✓（采用「逻辑会话」而非真多实例，符合已确认决策）
- 前端按归属摊开、非前台静默 → Task 5 ✓
- 发起方标识链路（已查证 env 现成）→ 复用，无需新建 ✓

**2. Placeholder scan：** 每个改码步骤均给出完整代码块；无 TBD/TODO/「类似上文」。Task 2 Step 4 引用 `browser-confirmation.ts` 的入参类型补字段——已注明「打开该文件按现有字段平铺加」，因该文件未读，给的是确定的字段名与下发位置，非占位。

**3. Type consistency：**
- `conversationId` 全链路统一为 `string | null`（bridge 解析数字 session 段为 string；前端比对前把 `selectedConversationId` `String(...)` 归一）✓
- `setActiveConversationId`（controller，Task 3）/ `setActiveBrowserConversationId`（store，Task 5）命名不同但属不同对象、职责不同（前者 Electron 主进程记 navigate 来源；后者 renderer store 记当前渲染归属），非笔误 ✓
- `noteBackgroundOpen` / `clearBackground` / `backgroundSessions` 在 Task 5 内自洽 ✓
- `resolveSession`（Task 1）导出名与测试 import 名一致 ✓

**4. 已知取舍（已与用户确认）：** 非前台会话页面不保活、不显示浮标；并发争用单视图未收敛（Task 7 可选）。

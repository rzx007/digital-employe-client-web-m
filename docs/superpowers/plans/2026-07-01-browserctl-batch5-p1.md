# browserctl Batch 5 P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 browserctl 相对 agent-browser 的 P1 缺口：`eval`、`wait --load load|domcontentloaded`、`get text`、`is *`、语义 `find`、`back/forward/reload`、`dialog`、`scrollintoview`、`batch`。

**Architecture:** 与第一轮相同——CDP（`browser-sdk/controller.ts`）→ bridge 路由 → CLI（`browserctl/index.js`）→ Skill/README 文档。5.3 前置 objectId 路径重构（find 不依赖 refCache）。5.5 `batch` 仅 CLI 层循环 `execute()`，不新增 bridge 路由；每条子命令仍 HTTP 调 bridge。dialog 用 `addMessageListener` + `pendingDialog`；bridge 响应必附 `warning` 当有未处理 confirm/prompt。

**Tech Stack:** TypeScript（browser-sdk）、Node.js `node:test` / `tsx --test`、CDP、HTTP bridge、ESM CLI。

**Spec:** `docs/superpowers/specs/2026-07-01-browserctl-batch5-p1-design.md`（**APPROVED**）。

**Branch:** 从 `dev` 切 `feat/browserctl-batch5-p1`。

**Plan review:** 2026-07-01 已对照 spec + 代码库自审并修订（见文末「计划审核记录」）。**执行前请先读该节。**

---

## Task 0: 开分支

- [ ] **Step 1: 从 dev 切分支**

```bash
git fetch origin dev
git checkout dev
git pull --rebase origin dev
git checkout -b feat/browserctl-batch5-p1
```

---

## File Structure

### 修改

| 文件 | 职责 |
|------|------|
| `packages/browser-sdk/src/controller.ts` | eval、waitForLoadEvent、getText、is*、objectId 重构、locate+find、back/forward/reload、dialog、scrollIntoView→CdpResult |
| `packages/browser-sdk/src/bridge.ts` | 新 action 路由；`errorCode()` 扩展；`reply()` 附加 dialog `warning` |
| `packages/browserctl/src/index.js` | 新命令 + `execute()` 抽取（供 batch 捕获返回值） |
| `packages/browser-sdk/test/controller.test.ts` | 各 batch mock-transport / eventTransport 单测 |
| `packages/browserctl/test/index.test.js` | CLI 分发 + batch 单测 |
| `apps/server/build-in-skills/browser-runtime/reference.md` | 命令 + 错误码 |
| `apps/server/build-in-skills/browser-runtime/SKILL.md` | 常用命令 + 兜底工作流 |
| `apps/server/build-in-skills/browser-runtime/examples.md` | eval/find/dialog/batch 示例 |
| `packages/browserctl/README.md` | 命令清单 |
| `packages/browserctl-cli/README.md` | 命令清单 |

### 可选新增

| 文件 | 职责 |
|------|------|
| `packages/browser-sdk/src/find-locate.ts` | 页内 locate JS 字符串（strategy 表），减轻 controller 体积——**仅当 controller 超 1500 行时拆** |

### 不动

- `transport.ts`、electron/chrome-transport（已有 `on("message")`）
- `browserctl-daemon` 宿主逻辑（新命令无 confirm）

---

## 共通约定

- controller `{ ok: false }` **必须显式 `code`**；bridge `errorCode()` defense-in-depth。
- 回归（**每个 batch 末**）：

```bash
cd packages/browser-sdk && npx tsx --test test/*.test.ts
cd packages/browserctl && node --test test/index.test.js
cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts
```

- **提交**：spec 约定 5 batch ≈ **5–7 commit**（5.1 合并 1 commit；5.3-pre 可独立；5.3a/5.3b 各 1）；只 `git add` 任务列出的文件，禁止 `git add .`。
- prefix：`feat(browser-sdk):` / `feat(browserctl):` / `docs(browser-runtime):`
- **每 batch 文档**：`reference.md` + `SKILL.md` + 两 README **同 commit 一起改**（不要拖到 5.6）。
- **`index.js` 导出**：`export { run, execute, parseFlags, … }`；batch 单测直接 `import { execute }`（不必 spawn 子进程）。
- **`eval` flag 独立**：用 `--file`/`--stdin`（**不是** fill 的 `--text-file`）；`parseFlags` 新增 `flags.file` / `flags.stdin`（eval 专用）或复用别名时在 plan 内写清映射。

---

## Batch 5.1 — eval + wait load 补全

### Task 5.1.1: `evaluateJs` + bridge/CLI `eval`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`
- Modify: `packages/browserctl/src/index.js`
- Test: `packages/browser-sdk/test/controller.test.ts`
- Test: `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 写失败测试（eval 成功）**

```typescript
test("evaluateJs 成功返回 value", async () => {
  const t = mockTransport({
    "Runtime.evaluate": {
      result: { type: "string", value: "hello" },
    },
  })
  const c = new BrowserController(t)
  const r = await c.evaluateJs("1+1", 5000)
  assert.equal(r.ok, true)
  assert.equal((r.data as { value: string }).value, "hello")
  const ev = t.calls.find(([m]) => m === "Runtime.evaluate")
  assert.equal((ev![1] as { awaitPromise?: boolean }).awaitPromise, true)
})
```

- [ ] **Step 2: 跑测试 → FAIL**

```bash
cd packages/browser-sdk && npx tsx --test test/controller.test.ts
```

- [ ] **Step 3: 实现 `evaluateJs`**

```typescript
async evaluateJs(
  js: string,
  timeoutMs = 10_000
): Promise<CdpResult<{ value: unknown; type?: string }>> {
  try {
    const result = await Promise.race([
      this.sendCommand("Runtime.evaluate", {
        expression: js,
        returnByValue: true,
        awaitPromise: true,
      }) as Promise<{
        result?: { value?: unknown; type?: string }
        exceptionDetails?: { text?: string }
      }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), timeoutMs)
      ),
    ])
    if (result.exceptionDetails?.text) {
      return {
        ok: false,
        error: result.exceptionDetails.text,
        code: "EVAL_ERROR",
      }
    }
    return {
      ok: true,
      data: {
        value: result.result?.value ?? null,
        type: result.result?.type,
      },
    }
  } catch (e) {
    const msg = (e as Error).message
    return {
      ok: false,
      error: msg,
      code: msg === "TIMEOUT" ? "TIMEOUT" : "EVAL_ERROR",
    }
  }
}
```

- [ ] **Step 4: 写失败测试（eval 异常 → EVAL_ERROR）**

```typescript
test("evaluateJs 异常返回 EVAL_ERROR", async () => {
  const t = mockTransport({
    "Runtime.evaluate": {
      exceptionDetails: { text: "Uncaught ReferenceError: x is not defined" },
    },
  })
  const c = new BrowserController(t)
  const r = await c.evaluateJs("x", 5000)
  assert.equal(r.ok, false)
  assert.equal(r.code, "EVAL_ERROR")
})
```

- [ ] **Step 5: bridge `case "eval"` + `errorCode` 加 `EVAL_ERROR`**

```typescript
      case "eval": {
        try { await host.ensureAttached() } catch {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" })
          return
        }
        const js = typeof body.js === "string" ? body.js : ""
        const timeoutMs = typeof body.timeout_ms === "number" ? body.timeout_ms : 10_000
        const result = await controller.evaluateJs(js, timeoutMs)
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

- [ ] **Step 6: CLI `eval` 分支 + `--file`/`--stdin`/`--timeout`**

新增 `resolveJsSource(rest, flags)`（**eval 专用**，勿复用 fill 的 `--text-file`）：

```javascript
async function resolveJsSource(rest, flags) {
  if (typeof flags.file === "string" && flags.file) {
    return fs.readFileSync(flags.file, "utf8").replace(/\r?\n$/, "")
  }
  if (flags.stdin) return (await readStdin()).replace(/\r?\n$/, "")
  return rest.join(" ")
}
```

`parseFlags` 增加：`--file` → `flags.file`；`--stdin` → `flags.stdin`（与 `--text-stdin` 分开，避免 fill/eval 语义混淆）。

`execute`/`run` 的 eval 分支 `return await postAction("eval", { js, timeout_ms })`。

- [ ] **Step 7: CLI 测试 mock bridge 收 `js`**

- [ ] **Step 8: eval 超时单测**（`evaluateJs` + 慢 Promise → `TIMEOUT`）

- [ ] **Step 9: 暂不 commit**（与 Task 5.1.2 合并为一个 Batch 5.1 commit）

---

### Task 5.1.2: `waitForLoadEvent` + CLI guard

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`（`wait` case 扩展）
- Modify: `packages/browserctl/src/index.js`（非法 `--load` guard）
- Test: `packages/browser-sdk/test/controller.test.ts`
- Test: `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 写失败测试（load 探针短路）**

```typescript
test("waitForLoadEvent(load)：已 complete 短路", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") return { result: { value: true } }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForLoadEvent("load", 5000)
  assert.equal(r.ok, true)
})
```

- [ ] **Step 2: 写失败测试（load 等 lifecycleEvent）**

```typescript
test("waitForLoadEvent(load)：等 load 事件", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") return { result: { value: false } }
    return {}
  })
  const c = new BrowserController(t)
  const p = c.waitForLoadEvent("load", 5000)
  await new Promise((r) => setTimeout(r, 20))
  t.emit("Page.lifecycleEvent", { name: "load" })
  assert.equal((await p).ok, true)
})
```

- [ ] **Step 3: 实现 `waitForLoadEvent(name: 'load' | 'DOMContentLoaded')`**

探针表达式：
- `load` → `document.readyState === 'complete'`
- `DOMContentLoaded` → `document.readyState !== 'loading'`

模式同 `waitForNetworkIdle`：`Page.enable` → 探针 → `addMessageListener` 过滤 `Page.lifecycleEvent.name === name` → `try/finally` disposer → 超时 `TIMEOUT`。

- [ ] **Step 4: bridge `wait` 分支**

```typescript
        if (load === "networkidle") {
          result = await controller.waitForNetworkIdle(timeoutMs)
        } else if (load === "load") {
          result = await controller.waitForLoadEvent("load", timeoutMs)
        } else if (load === "domcontentloaded") {
          result = await controller.waitForLoadEvent("DOMContentLoaded", timeoutMs)
        } else if (url) {
          result = await controller.waitForUrl(url, timeoutMs)
        // …其余 wait 分支不变
        }
```

（删除 bridge 对未知 `load` 的 400 分支——CLI guard 保证只有三值到达 bridge。）

- [ ] **Step 5: CLI guard 非法 `--load`**

在 `wait` 分支，`flags.load` 存在且不在 `load|domcontentloaded|networkidle` 时 `throw new Error(...)`。

- [ ] **Step 6: CLI 测试 `wait --load load` payload**

- [ ] **Step 7: 更新 reference + SKILL（wait load 三值 + DCL 已知限制 + eval）**

- [ ] **Step 8: 回归 + **一个** Batch 5.1 commit**

```bash
git add packages/browser-sdk/src/controller.ts packages/browser-sdk/src/bridge.ts \
  packages/browser-sdk/test/controller.test.ts \
  packages/browserctl/src/index.js packages/browserctl/test/index.test.js \
  apps/server/build-in-skills/browser-runtime/reference.md \
  apps/server/build-in-skills/browser-runtime/SKILL.md \
  packages/browserctl/README.md packages/browserctl-cli/README.md
git commit -m "feat(browserctl): Batch 5.1 eval + wait --load load|domcontentloaded"
```

**注意**：非法 `--load` 仅在 **CLI** 抛错（`CLI_USAGE_ERROR`）；bridge 不应收到未知 load 值（CLI guard 先行）。

---

## Batch 5.2 — get text + is *

### Task 5.2.1: `getText` + bridge/CLI

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`（`get-text` case）
- Modify: `packages/browserctl/src/index.js`（`get text`）
- Test: 两包 test

- [ ] **Step 1: 失败测试 getText**

```typescript
test("getText 返回 innerText", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: { x: 1, y: 1 } } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } },
    "Runtime.callFunctionOn": { result: { value: "按钮文字" } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  const r = await c.getText("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { text: string }).text, "按钮文字")
})
```

- [ ] **Step 2: 实现 `getText`**（同 Task 4.1 spec：`runOnElement` + innerText）

- [ ] **Step 3: bridge `case "get-text"`** + body `{ ref_or_selector }`

- [ ] **Step 4: CLI `get text`** + guard 扩展为 `url|title|value|attr|text`

- [ ] **Step 5: CLI 测试 mock bridge 收 `ref_or_selector`**

- [ ] **Step 6: 暂不单独 commit**（与 5.2.2 合并）

---

### Task 5.2.2: `isVisible` / `isEnabled` / `isChecked`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`（`is-visible` / `is-enabled` / `is-checked` 或统一 `is` body）
- Modify: `packages/browserctl/src/index.js`

- [ ] **Step 1: 三态测试 visible**

```typescript
test("isVisible：存在且可见 → result true", async () => { /* mock callFunctionOn → true */ })
test("isVisible：存在但 hidden → result false, ok true", async () => { /* → false */ })
test("isVisible：不存在 → ELEMENT_NOT_FOUND", async () => { /* resolveNode null */ })
```

- [ ] **Step 2: 实现页内 JS**

visible:
```js
const cs = getComputedStyle(el);
const r = el.getBoundingClientRect();
return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
```

enabled:
```js
return !el.disabled && el.getAttribute('aria-disabled') !== 'true';
```

checked: 复用 `isChecked()`；`null` → `{ ok: false, code: "NOT_CHECKABLE" }`；boolean → `{ ok: true, data: { result: v } }`

- [ ] **Step 3: bridge 三条路由或单路由 `{ kind, ref_or_selector }`**

推荐单路由 `POST /is` body `{ kind: "visible"|"enabled"|"checked", ref_or_selector }` 减少 case 膨胀。

- [ ] **Step 4: CLI**

```javascript
  if (command === "is") {
    const kind = rest[0]
    const refOrSelector = rest[1]
    if (!["visible", "enabled", "checked"].includes(kind))
      throw new Error("is kind must be visible|enabled|checked")
    print(await postAction("is", { kind, ref_or_selector: refOrSelector }), flags.pretty)
    return
  }
```

- [ ] **Step 5: CLI 测试 + reference 三态表 + SKILL + Commit**

```bash
git commit -m "feat(browserctl): Batch 5.2 get text + is visible|enabled|checked"
```

---

## Batch 5.3 — find 语义定位

> **两个 commit 建议**：5.3-pre（objectId 重构）+ 5.3a（selector 系 find）+ 5.3b（语义系 find）。最少 5.3-pre 与 5.3a 同 commit，5.3b 单独 commit。

### Task 5.3-pre: objectId 路径重构

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 抽取 `clickAt(x, y)`**

从 `click()` 抽出 mousePressed/mouseReleased；`click(ref)` 仍 scrollIntoView → resolveNode → clickAt。

- [ ] **Step 2: 实现 `runOnObjectId(objectId, funcBody, returnByValue?)`**

- [ ] **Step 3: 实现 objectId 版 action helpers**

| 方法 | 要点 |
|------|------|
| `fillOnObjectId` | focus → objectId 版 clear（原型 setter）→ `Input.insertText` |
| `typeOnObjectId` | focus → 逐字符 insertText（同现有 `type`） |
| `focusOnObjectId` | `callFunctionOn` focus |
| `hoverOnObjectId` | `callFunctionOn` getBoundingClientRect → `clickAt` 的 mouseMoved |
| `checkOnObjectId` / `uncheckOnObjectId` | `callFunctionOn` 读 checked（复用 isChecked JS 体）→ 不符则 `clickAt` center → JS `.click()` 兜底 |

**find 的 8 种 action 全部走 objectId 路径**，不得回退 `resolveNode(@eN)`。

- [ ] **Step 4: 失败测试 clickAt 被调用**

```typescript
test("clickAt 派发 pressed+released", async () => {
  const t = mockTransport({})
  const c = new BrowserController(t)
  await c.clickAt(50, 60)
  const types = t.calls.filter(([m]) => m === "Input.dispatchMouseEvent").map(([, p]) => (p as { type: string }).type)
  assert.deepEqual(types, ["mousePressed", "mouseReleased"])
})
```

- [ ] **Step 5: `scrollIntoView` 改为 `Promise<CdpResult>`**

元素不存在 → `{ ok: false, code: "ELEMENT_NOT_FOUND" }`。

**调用方约定**：`click`/`hover`/`dblclick` 在 `scrollIntoView` 返回失败时 **直接 propagate**（不再用旧坐标点击）；`scroll(ref)`  propagate 失败。

- [ ] **Step 6: 单测 scrollintoview 找不到 + 回归现有 click 测试 + Commit**

```bash
git commit -m "feat(browser-sdk): objectId helpers + scrollIntoView CdpResult (Batch 5.3 prep)"
```

---

### Task 5.3a: find selector 系（first/last/nth/testid/placeholder）

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（`locateInMainFrame` + `findAndAct`）
- Modify: `packages/browser-sdk/src/bridge.ts`（`find` case）
- Modify: `packages/browserctl/src/index.js`
- Test: 两包 test

- [ ] **Step 1: 页内 locate JS（selector 系）**

`Runtime.evaluate` 返回元素 objectId（**不要** returnByValue）：

```javascript
// first + selector
(() => document.querySelector(SEL))()

// nth: 1-based
(() => document.querySelectorAll(SEL)[N - 1])()

// testid: exact
(() => document.querySelector('[data-testid="' + ID.replace(/"/g, '\\"') + '"]'))()

// placeholder: contains (case-sensitive)
(() => {
  const ph = PH.toLowerCase();
  for (const el of document.querySelectorAll('input[placeholder],textarea[placeholder]')) {
    if ((el.getAttribute('placeholder')||'').toLowerCase().includes(ph)) return el;
  }
  return null;
})()
```

从 evaluate 响应取 `result.objectId`；无 objectId → locate 失败。

- [ ] **Step 2: `findAndAct(strategy, query, action, value?, opts?)`**

locate → 按 action 委托 objectId 路径；`text` → runOnObjectId 读 innerText。

- [ ] **Step 3: 失败测试 find first + click**

- [ ] **Step 4: 失败测试 find nth 1-based**

```typescript
// querySelectorAll 返回 3 个，nth 2 应点第二个
```

- [ ] **Step 5: bridge + CLI 解析**

CLI 结构：`find <strategy> ...` 解析 strategy 与 positional args；`--text-file`/`--text-stdin` 给 fill/type。

- [ ] **Step 6: 文档 + Commit**

```bash
git commit -m "feat(browserctl): Batch 5.3a find first|last|nth|testid|placeholder"
```

---

### Task 5.3b: find 语义系（role/text/label/alt/title）

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（扩展 locate）
- Test + docs

- [ ] **Step 1: role locate JS（简化隐式 role 表 + --name + --exact）**

accessible name 读取顺序：`aria-label` → `title` → `innerText.trim()`（与 spec 一致）。

- [ ] **Step 2: text locate（最小包含元素 + exact/normalize-space）**

- [ ] **Step 3: label locate（label 文本 match → control/for）**

- [ ] **Step 4: alt / title contains**

- [ ] **Step 5: 单测 find role --name、find text --exact、find label**

- [ ] **Step 6: examples.md 加 baidu `find role button click --name 百度一下` + Commit**

```bash
git commit -m "feat(browserctl): Batch 5.3b find role|text|label|alt|title"
```

---

## Batch 5.4 — 导航 + 弹窗 + scrollintoview

### Task 5.4.1: back / forward / reload

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`
- Modify: `packages/browserctl/src/index.js`
- Test: controller.test.ts + index.test.js

- [ ] **Step 1: 失败测试 back 后 getUrl**

```typescript
test("back 调 Page.goBack 并返回 getUrl/getTitle", async () => {
  let evalN = 0
  const t = mockTransport({
    "Page.goBack": {},
    "Runtime.evaluate": () => {
      evalN++
      if (evalN === 1) return { result: { value: "complete" } } // readyState
      if (evalN === 2) return { result: { value: "https://prev.example/" } }
      return { result: { value: "Prev Title" } }
    },
  })
  const c = new BrowserController(t)
  const r = await c.back()
  assert.equal(r.ok, true)
  assert.equal((r.data as { url: string }).url, "https://prev.example/")
  assert.ok(t.calls.some(([m]) => m === "Page.goBack"))
})
```

- [ ] **Step 2: 实现 `back`/`forward`/`reload`**

```typescript
async back(): Promise<CdpResult<{ url: string; title: string }>> {
  try {
    await this.sendCommand("Page.enable")
    await this.sendCommand("Page.goBack")
    await this.waitForLoadComplete(30_000)
    const urlR = await this.getUrl()
    const title = await this.getTitle()
    return { ok: true, data: { url: urlR.data?.url ?? "", title } }
  } catch (e) {
    return { ok: false, error: (e as Error).message, code: (e as Error).message === "TIMEOUT" ? "TIMEOUT" : "BROWSER_ERROR" }
  }
}
```

`forward` / `reload` 同理。

- [ ] **Step 3: bridge `back`/`forward`/`reload` 三个 case**（或单 case `navigate-history` + body.action）

- [ ] **Step 4: CLI 三命令**

- [ ] **Step 5: index.test.js 三条 mock POST**

- [ ] **Step 6: 文档；与 5.4.2/5.4.3 合并一个 Batch 5.4 commit**（navigation + dialog + scrollintoview 同批交付）

**测试注意**：`mockTransport` 默认不支持函数响应；back 单测需像现有 OOPIF 测试一样 **override `sendCommand`**。

---

### Task 5.4.2: dialog 基础设施 + CLI

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`
- Modify: `packages/browser-sdk/src/bridge.ts`（`reply` 包装 warning + dialog routes + `DIALOG_NOT_PENDING`）
- Modify: `packages/browserctl/src/index.js`
- Test: controller.test.ts + index.test.js

- [ ] **Step 1: controller 字段 + **合并进现有** constructor dispatcher**

**禁止**再注册第二个 `transport.on("message")`（Electron/chrome-transport 仅一个槽）。在**已有** constructor 回调里 **先于** `messageListeners` 循环处理 dialog：

```typescript
private pendingDialog: { type: string; message: string } | null = null

constructor(private transport: Transport) {
  transport.on("message", (method, params, sessionId) => {
    if (method === "Page.javascriptDialogOpening") {
      const p = params as { type?: string; message?: string }
      const type = p.type ?? "alert"
      if (type === "alert" || type === "beforeunload") {
        void this.sendCommand("Page.handleJavaScriptDialog", { accept: true })
        this.pendingDialog = null
      } else {
        this.pendingDialog = { type, message: p.message ?? "" }
      }
    }
    for (const l of this.messageListeners) {
      if (l.pred(method, params, sessionId)) l.cb()
    }
  })
}

/** bridge 读 pending 用 */
getPendingDialog() {
  return this.pendingDialog
}
```

- [ ] **Step 2: 单测 alert 自动 accept**

eventTransport + emit `Page.javascriptDialogOpening` type alert → 断言 `handleJavaScriptDialog` 被调且 `pendingDialog` 为 null。

- [ ] **Step 3: 单测 confirm 置 pending**

- [ ] **Step 4: `dialogAccept` / `dialogDismiss` / `getDialogStatus`**

无 pending → `DIALOG_NOT_PENDING`。

- [ ] **Step 5: bridge `wrapReply(res, result)` 附加 warning**

扩展 `BrowserResponse` 类型加可选 `warning?: string`。改 `reply(res, status, body, controller?)` 或在 `handleBridgeRequest` 末尾统一：

```typescript
function attachDialogWarning(
  controller: BrowserController,
  body: BrowserResponse
): BrowserResponse {
  const pending = controller.getPendingDialog()
  if (!pending) return body
  return {
    ...body,
    warning: `JavaScript dialog pending: ${pending.type} — ${pending.message}`,
  }
}
```

**所有** action 的 `reply()` 经此包装（spec 必做，非可选）。

- [ ] **Step 6: CLI `dialog accept|dismiss|status`**

- [ ] **Step 7: errorCode 加 `DIALOG_NOT_PENDING` + reference + Commit**

```bash
git commit -m "feat(browserctl): Batch 5.4 navigation + dialog + scrollintoview CLI"
```

---

### Task 5.4.3: scrollintoview CLI（controller 已在 5.3-pre 改完）

**Files:**
- Modify: `packages/browser-sdk/src/bridge.ts`（`scrollintoview` case）
- Modify: `packages/browserctl/src/index.js`
- Test: index.test.js

- [ ] **Step 1: bridge + CLI `scrollintoview` / 别名 `scroll-into-view`**

- [ ] **Step 2: 文档：`scroll @eN` ≡ `scrollintoview @eN`**

- [ ] **Step 3: 若 5.4.2 commit 未含 scrollintoview CLI，本 task 单独 commit；否则合并**

---

## Batch 5.5 — batch

### Task 5.5.1: `execute()` 抽取 + `batch` 命令

**Files:**
- Modify: `packages/browserctl/src/index.js`
- Test: `packages/browserctl/test/index.test.js`
- Docs: reference, SKILL, examples

- [ ] **Step 1: 重构 `run` → `execute` 返回结果**

```javascript
async function execute(argv, baseUrl) {
  if (baseUrl) activeBaseUrl = baseUrl
  const { args, flags } = parseFlags(argv)
  const [command, ...rest] = args
  // help/version：写 stdout，return undefined
  // 各 command：return await postAction(...) 或 snapshot 文本 envelope
  // 未知 command：throw Error（batch 捕获为 CLI_USAGE_ERROR）
}

async function run(argv, baseUrl) {
  try {
    const { flags } = parseFlags(argv)
    const result = await execute(argv, baseUrl)
    if (result !== undefined) print(result, flags.pretty)
  } catch (error) {
    print({ ok: false, error: error.message, code: "CLI_USAGE_ERROR" })
  }
}

export { run, execute, parseFlags, normalizeUrl, formatSnapshotText, resolveArtifactRealPath, resolveSession }
```

**snapshot `--interactive`/`--tree`**：`execute` 返回 `{ ok: true, data: { format: "text", text } }`；**batch 模式下不**向 stdout 写中间 snapshot 文本（仅最终 batch JSON）。

**stdin 冲突**：`batch --json` 与 `eval --stdin` 互斥使用；同一进程不会同时读 stdin 两次。

- [ ] **Step 2: 失败测试 batch 顺序（import execute）**

```javascript
import { execute } from "../src/index.js"
// mock startServer；await execute(["batch", "health", "get-url"], { env: { BROWSER_RUNTIME_BRIDGE_URL } })
// 或 execute 传 baseUrl 第二参数 + 内联 mock
```

mock server 计数 POST 次数 = 2。

- [ ] **Step 3: 实现 batch**

```javascript
  if (command === "batch") {
    if (rest.some((line) => line.startsWith("batch"))) throw new Error("nested batch not allowed")
    const commands = flags.json ? JSON.parse(await readStdin()) : rest
    const results = []
    for (let i = 0; i < commands.length; i++) {
      const argv = Array.isArray(commands[i]) ? commands[i] : splitBatchLine(commands[i])
      if (argv[0] === "batch") throw new Error("nested batch not allowed")
      let result
      try {
        result = await execute(argv, activeBaseUrl)
      } catch (e) {
        result = { ok: false, error: e.message, code: "CLI_USAGE_ERROR" }
      }
      results.push(result ?? { ok: true })
      if (flags.bail && result && result.ok === false) {
        print({ ok: false, data: { failedAt: i, results } }, flags.pretty)
        return
      }
    }
    const allOk = results.every((r) => r && r.ok !== false)
    print({ ok: allOk, data: { results } }, flags.pretty)
    return
  }
```

`splitBatchLine`：简单按空格分（引号内保留）——或要求 `--json` 模式用于复杂参数；文档写明 argument 模式用 shell 引号包裹整命令。

- [ ] **Step 4: 测试 `--bail` 第二条失败停止**

- [ ] **Step 5: 测试 `--json` stdin**

- [ ] **Step 6: reference / examples batch 工作流 + Commit**

```bash
git commit -m "feat(browserctl): Batch 5.5 batch command (CLI-only)"
```

---

## Task 5.6: 合流与验收

- [ ] **Step 1: 全量回归**

```bash
cd packages/browser-sdk && npx tsx --test test/*.test.ts
cd packages/browserctl && node --test test/index.test.js
cd packages/browserctl-daemon && npx tsx --test test/*.test.ts
pnpm typecheck --filter @workspace/browser-sdk --filter @workspace/browserctl
```

- [ ] **Step 2: `browserctl --help` 人工核对与 reference 一致**

- [ ] **Step 3: 可选真页冒烟（daemon 或 Electron）**

```bash
BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl eval "document.title"
BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl is visible "#kw"
BROWSER_RUNTIME_BRIDGE_URL=http://127.0.0.1:34555 browserctl batch "open https://www.baidu.com" "wait --load domcontentloaded" "snapshot --interactive"
```

- [ ] **Step 4: 核对各 batch 已同步 SKILL.md（不应留到此处才补）**

- [ ] **Step 5: `superpowers:finishing-a-development-branch` 合回 `dev`**

---

## 风险与决策记录

| 风险 | 缓解 |
|------|------|
| find locate JS 与站点 DOM 差异大 | 5.3b 单测 + examples 用 baidu；失败返回 ELEMENT_NOT_FOUND |
| dialog listener 与 wait listener 竞态 | dialog 处理在 constructor 总 dispatcher **先于** 其他 listener |
| batch snapshot 文本 vs JSON | execute 统一 envelope；文档推荐 batch 内用默认 JSON snapshot |
| controller 膨胀 | 超 1500 行时拆 `find-locate.ts` |

---

## 计划审核记录（2026-07-01）

| 严重度 | 问题 | 修订 |
|--------|------|------|
| 🔴 | 未写开分支 Task | 增加 Task 0 |
| 🔴 | dialog 计划写「再注册 transport.on」与现有 constructor **冲突** | 改为合并进已有 dispatcher |
| 🔴 | 5.3-pre 缺 `check/uncheck` objectId 路径 | 补全 action helpers 表 |
| 🔴 | eval 误用 fill 的 `--text-file` | 改为 eval 专用 `--file`/`--stdin` |
| 🟡 | 5.2.1 / 5.4.1 步骤含糊（「Step 2–4」） | 拆成逐步 |
| 🟡 | 计划标 APPROVED 但未自审 | 本表 + 状态改为 REVISED |
| 🟡 | `execute` 未要求 export，batch 测只能靠 spawn | 补 export + import 测法 |
| 🟡 | bridge `warning` 写「可选」与 spec 必做矛盾 | 改为必做 + 扩展类型 |
| 🟡 | 5.1 拆 2 commit 与 spec「5 batch = 5 commit」不一致 | 5.1 合并 1 commit |
| 🟡 | back 单测 mock 写法与 `mockTransport` 能力不符 | 注明 override sendCommand |
| 🟢 | scrollIntoView 失败后 click 行为未定义 | 明确 propagate |
| 🟢 | SKILL 文档拖到 5.6 | 改为每 batch 同 commit 同步 |

**与 spec 对齐检查**：5 batch 范围、objectId find、batch HTTP 语义、错误码 — ✅（修订后）。

**仍留给实施者判断**：`splitBatchLine` 是否实现（argument 模式可要求用户只用 shell 引号 + `--json` 兜底）；controller >1500 行是否拆 `find-locate.ts`。

---

## 状态

**APPROVED** — 2026-07-01 确认，执行中。Spec：`docs/superpowers/specs/2026-07-01-browserctl-batch5-p1-design.md`。

# browserctl 对齐 agent-browser 命令集（第一轮）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `browserctl` 命令集向 `agent-browser` 对齐，补齐 8 条交互命令、4 条 wait 增强、3 条 snapshot 过滤、`screenshot --annotate`，并升级 `fill` 为 `Input.insertText`。

**Architecture:** 每条新命令 = 4 处同步：CDP 实现（`browser-sdk/controller.ts`）→ HTTP 路由（`browser-sdk/bridge.ts`）→ CLI 分发（`browserctl/src/index.js`）→ 文档（`reference.md` / `SKILL.md` / `README.md` ×2）。`controller` 纯 CDP 逻辑、宿主差异由 `bridge` 持有的 `Host` 处理；新交互命令不涉及 `--confirm`，两端行为一致。唯一基础设施改动：`controller` 构造时注册总 `transport.on("message", dispatcher)` 做事件多路复用。

**Tech Stack:** TypeScript（`browser-sdk`）、Node.js 原生 `node:test`、CDP（Chrome DevTools Protocol）、HTTP bridge（`node:http`）、ESM CLI（`browserctl`）。

**Spec:** `docs/superpowers/specs/2026-06-30-browserctl-align-agent-browser-design.md`（已 APPROVED）。

**Branch:** `feat/browserctl-align-agent-browser`（已存在，本计划在其上继续）。

---

## File Structure

### 修改
- `packages/browser-sdk/src/controller.ts` — 加 `hover / dblclick / focus / type / check / uncheck / drag / upload / wait variants / annotate screenshot` 方法 + 事件多路复用基础设施。
- `packages/browser-sdk/src/bridge.ts` — 加对应 `POST /<cmd>` 路由 + 扩展 `errorCode()` 映射。
- `packages/browser-sdk/src/ax-tree.ts` — `buildRefs` 加 `compact / maxDepth / scopeSelector` 选项。
- `packages/browserctl/src/index.js` — 加命令分支 + flag 解析 + help 文本 + `wait` guard 扩展。
- `packages/browserctl/test/index.test.js` — 加 CLI 分发测试。
- `packages/browser-sdk/test/controller.test.ts` — 加新方法 mock-transport 单测。
- `packages/browser-sdk/test/ax-tree.test.ts` — 加 compact/depth/scope 单测。
- `apps/server/build-in-skills/browser-runtime/reference.md` — 命令清单 + 错误码表 + OOPIF annotate 说明。
- `apps/server/build-in-skills/browser-runtime/SKILL.md` — 命令清单。
- `apps/server/build-in-skills/browser-runtime/examples.md` — 新命令用例（按需）。
- `packages/browserctl/README.md` — 命令清单与说明。
- `packages/browserctl-cli/README.md` — 命令清单与说明。

### 不动
- `packages/browser-sdk/src/transport.ts`（`on("message", cb)` 已是单 callback 接口，直接用）。
- `apps/web/electron/features/browser/electron-transport.ts`、`packages/browserctl-daemon/src/chrome-transport.ts`（已实现 `on("message", ...)` 转发 CDP 事件）。
- `packages/browserctl-daemon/src/standalone-host.ts`（新命令不涉及 confirm）。

---

## 共通约定（所有 batch 适用）

- **错误码**：controller 新方法返回 `{ok:false}` 时**必须显式带 `code` 字段**（不依赖 bridge 兜底映射）。
- **bridge `errorCode()`**：每个 batch 末按需扩展映射表（defense-in-depth）。
- **`ref|sel` 解析**：复用现有 `resolveNode`（`@eN` 走 refCache + `DOM.resolveNode`；CSS selector 走 `Runtime.evaluate` + `document.querySelector`）。
- **回归命令**（每个 batch 末必跑）：
  ```bash
  cd packages/browser-sdk && npx tsx --test test/*.test.ts
  cd packages/browserctl && npx tsx --test test/index.test.js
  cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts
  ```
- **提交规范**：commit message 前缀 `feat(browser-sdk):` / `feat(browserctl):` / `docs(browserctl):`（按主要改动面）。**只 `git add` 自己明确列出的文件，禁止 `git add .` / `-A`**。

---

## Batch 1 — 交互命令（8 条 + fill 升级）

### Task 1.1: fill 升级为 `Input.insertText`（非破坏性）

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts:231-266`（`fill` 方法的输入段）
- Test: `packages/browser-sdk/test/controller.test.ts`（加 `fill` 用 insertText 断言）

- [ ] **Step 1: 写失败测试**

追加到 `packages/browser-sdk/test/controller.test.ts`：

```typescript
test("fill 用 Input.insertText 一次性输入（非逐字符 dispatchKeyEvent char）", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: { x: 10, y: 10 } } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.fill("#kw", "关键词")
  // 不应出现逐字符 Input.dispatchKeyEvent {type:"char"}
  const charCalls = t.calls.filter(([m, p]) => m === "Input.dispatchKeyEvent" && (p as { type?: string }).type === "char")
  assert.equal(charCalls.length, 0, "不应再发逐字符 char 事件")
  // 应有一次 Input.insertText
  const insertCalls = t.calls.filter(([m]) => m === "Input.insertText")
  assert.ok(insertCalls.length >= 1, "应调用 Input.insertText")
  assert.equal((insertCalls[0][1] as { text?: string }).text, "关键词")
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/browser-sdk && npx tsx --test test/controller.test.ts
```
Expected: 新测试 FAIL（当前实现发逐字符 `dispatchKeyEvent {type:"char"}`，无 `insertText`）。

- [ ] **Step 3: 改 `fill` 输入段**

`packages/browser-sdk/src/controller.ts` 的 `fill` 方法，把 `for (const char of text) { await this.sendCommand("Input.dispatchKeyEvent", { type: "char", text: char }) }` 替换为：

```typescript
      // 输入：单次 Input.insertText（agent-browser 注释：VS Code/Electron webview
      // 拒绝重复 printable dispatchKeyEvent，printable 走 insertText 更可靠）
      await this.sendCommand("Input.insertText", { text })
```

保留 `clearElement`（原型 setter 清空，React/Vue 友好）与 click-to-focus 不动。

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/browser-sdk && npx tsx --test test/controller.test.ts
```
Expected: PASS（含新测试）。

- [ ] **Step 5: 真实页面冒烟（验收门禁）**

```bash
# 启动 daemon（或 Electron dev），然后：
node packages/browserctl/src/index.js open https://www.baidu.com
node packages/browserctl/src/index.js snapshot --interactive
# 用返回的 @eN 指向搜索框
node packages/browserctl/src/index.js fill @eN "关键词"
node packages/browserctl/src/index.js get value @eN
```
Expected: `get value` 返回 `{"ok":true,"data":{"value":"关键词"}}`。若返回空/旧值 → insertText 在该页面失效，回退逐字符 `dispatchKeyEvent {type:"char"}` 并在 commit message 标 `DONE_WITH_CONCERNS`。这是明确 pass/fail 信号。

- [ ] **Step 6: 暂不提交**（与 Batch 1 其余命令一起在 Task 1.10 提交）

---

### Task 1.2: `hover <ref|sel>`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `hover` 方法）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("hover 派发单次 mouseMoved 到元素中心", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 100, 0, 100] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.hover("@e0")
  const moved = t.calls.filter(([m, p]) => m === "Input.dispatchMouseEvent" && (p as { type?: string }).type === "mouseMoved")
  assert.equal(moved.length, 1)
  const p = moved[0][1] as { x: number; y: number }
  assert.equal(p.x, 50)
  assert.equal(p.y, 50)
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd packages/browser-sdk && npx tsx --test test/controller.test.ts
```
Expected: FAIL（`hover` 未定义）。

- [ ] **Step 3: 实现 `hover`**

在 `controller.ts` 的 `click` 方法后加：

```typescript
  async hover(refOrSelector: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(refOrSelector)
      const fresh = await this.resolveNode(refOrSelector)
      if (!fresh) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const { x, y } = fresh.center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd packages/browser-sdk && npx tsx --test test/controller.test.ts
```
Expected: PASS。

---

### Task 1.3: `dblclick <ref|sel>`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `dblclick`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("dblclick 派发 clickCount:2 的 pressed+released", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.dblclick("@e0")
  const pressed = t.calls.filter(([m, p]) => m === "Input.dispatchMouseEvent" && (p as { type?: string }).type === "mousePressed")
  const released = t.calls.filter(([m, p]) => m === "Input.dispatchMouseEvent" && (p as { type?: string }).type === "mouseReleased")
  assert.equal(pressed.length, 1)
  assert.equal(released.length, 1)
  assert.equal((pressed[0][1] as { clickCount?: number }).clickCount, 2)
  assert.equal((released[0][1] as { clickCount?: number }).clickCount, 2)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `dblclick`**

```typescript
  async dblclick(refOrSelector: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(refOrSelector)
      const fresh = await this.resolveNode(refOrSelector)
      if (!fresh) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const { x, y } = fresh.center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 2,
      })
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 2,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.4: `focus <ref|sel>`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `focus`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("focus 调 callFunctionOn this.focus()", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.focus("@e0")
  const callFn = t.calls.filter(([m, p]) => m === "Runtime.callFunctionOn" && String((p as { functionDeclaration?: string }).functionDeclaration).includes("this.focus()"))
  assert.ok(callFn.length >= 1)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `focus`**

```typescript
  async focus(refOrSelector: string): Promise<CdpResult> {
    try {
      const node = await this.resolveNode(refOrSelector)
      if (!node?.backendNodeId) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const resolved = (await this.sendCommand("DOM.resolveNode", {
        backendNodeId: node.backendNodeId,
      })) as { object?: { objectId?: string } }
      if (!resolved.object?.objectId) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      await this.sendCommand("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration: "function(){ this.focus(); }",
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.5: `type <ref|sel> <text>`（不清空）

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `type`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("type 不清空：printable 走 insertText，\\n 走 keyDown+keyUp", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.type("@e0", "ab\n")
  // focus 调用
  const focusCalls = t.calls.filter(([m, p]) => m === "Runtime.callFunctionOn" && String((p as { functionDeclaration?: string }).functionDeclaration).includes("this.focus()"))
  assert.ok(focusCalls.length >= 1)
  // printable "ab" 走 Input.insertText（逐字符，agent-browser type_text 语义）
  const insertCalls = t.calls.filter(([m]) => m === "Input.insertText")
  assert.ok(insertCalls.some(([, p]) => (p as { text?: string }).text === "a"))
  assert.ok(insertCalls.some(([, p]) => (p as { text?: string }).text === "b"))
  // \n 走 keyDown+keyUp（Enter）
  const keyDown = t.calls.filter(([m, p]) => m === "Input.dispatchKeyEvent" && (p as { type?: string }).type === "keyDown")
  const keyUp = t.calls.filter(([m, p]) => m === "Input.dispatchKeyEvent" && (p as { type?: string }).type === "keyUp")
  assert.ok(keyDown.length >= 1)
  assert.ok(keyUp.length >= 1)
  // 不应出现 clearElement 相关的原型 setter（无 clear 调用）
  const clearCalls = t.calls.filter(([m, p]) => m === "Runtime.callFunctionOn" && String((p as { functionDeclaration?: string }).functionDeclaration).includes("setter.call(el, '')"))
  assert.equal(clearCalls.length, 0, "type 不应清空")
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `type`**

```typescript
  async type(refOrSelector: string, text: string): Promise<CdpResult> {
    try {
      const node = await this.resolveNode(refOrSelector)
      if (!node?.backendNodeId) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const resolved = (await this.sendCommand("DOM.resolveNode", {
        backendNodeId: node.backendNodeId,
      })) as { object?: { objectId?: string } }
      if (!resolved.object?.objectId) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      await this.sendCommand("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration: "function(){ this.focus(); }",
      })
      for (const ch of text) {
        if (ch === "\n" || ch === "\r") {
          const k = resolveKey("Enter")
          await this.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode })
          await this.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode })
        } else if (ch === "\t") {
          const k = resolveKey("Tab")
          await this.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode })
          await this.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode })
        } else {
          await this.sendCommand("Input.insertText", { text: ch })
        }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.6: `check` / `uncheck <ref|sel>`（三步法）

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `isChecked` + `check` + `uncheck`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("check：未勾选时点击，再回读校验", async () => {
  // 第一次 runOnElement(isChecked) 返回 false → 点击 → 第二次回读 true
  let evalCount = 0
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": { result: { value: false } },
  })
  // 用 callFnCount 模拟 isChecked 多次回读（前两次 false、JS-click 后 true）
  const origSend = t.sendCommand
  let callFnCount = 0
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Runtime.callFunctionOn") {
      callFnCount++
      return { result: { value: callFnCount <= 2 ? false : true } }
    }
    return ({}) as unknown
  }
  const c = new BrowserController(t)
  const r = await c.check("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { checked?: boolean }).checked, true)
})
```

> 注：上述 mock 用 `isCheckedCall` 专用计数器模拟 `isChecked` 的多次回读（前两次 false、JS-click 后第三次 true）。`isChecked` 内部用 `runOnElement`（走 `callFunctionOn`），点击用 `Input.dispatchMouseEvent`，JS-click 兜底也走 `runOnElement`（返回值被 `setChecked` 忽略）。

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `isChecked` + `check` + `uncheck`**

在 `controller.ts` 加：

```typescript
  // 四级回退读 checked 状态（对齐 agent-browser element::is_element_checked）
  // level-4（嵌套 input）为 best-effort：取 querySelector 第一个匹配，可能命中无关后代 checkbox。
  private async isChecked(refOrSelector: string): Promise<boolean | null> {
    const v = await this.runOnElement(
      refOrSelector,
      `
      const el = this;
      // level 1: native checkbox/radio
      if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return !!el.checked;
      // level 2: ARIA role
      const role = el.getAttribute('role');
      if (['checkbox','radio','switch','menuitemcheckbox','menuitemradio','option','treeitem'].includes(role)) {
        return el.getAttribute('aria-checked') === 'true';
      }
      // level 3: label.control
      const label = el.closest('label');
      if (label && label.control) return !!label.control.checked;
      // level 4 (best-effort, first match): 嵌套 input
      const inner = el.querySelector('input[type=checkbox],input[type=radio]');
      if (inner) return !!inner.checked;
      return null;
      `
    )
    return typeof v === "boolean" ? v : null
  }

  async check(refOrSelector: string): Promise<CdpResult<{ checked: boolean }>> {
    return this.setChecked(refOrSelector, true)
  }

  async uncheck(refOrSelector: string): Promise<CdpResult<{ checked: boolean }>> {
    return this.setChecked(refOrSelector, false)
  }

  private async setChecked(refOrSelector: string, expect: boolean): Promise<CdpResult<{ checked: boolean }>> {
    try {
      let cur = await this.isChecked(refOrSelector)
      if (cur === expect) return { ok: true, data: { checked: cur } }
      // step 2: 坐标点击
      await this.click(refOrSelector)
      cur = await this.isChecked(refOrSelector)
      if (cur === expect) return { ok: true, data: { checked: cur } }
      // step 3: JS-click 兜底（带 label 重定向）
      await this.runOnElement(
        refOrSelector,
        `
        const el = this;
        const label = el.closest('label');
        const target = (label && label.control) ? label.control : el;
        target.click();
        `
      )
      cur = await this.isChecked(refOrSelector)
      if (cur === expect) return { ok: true, data: { checked: cur } }
      return { ok: false, error: "not checkable", code: "NOT_CHECKABLE" }
    } catch (e) {
      const msg = (e as Error).message
      if (msg === "ELEMENT_NOT_FOUND") return { ok: false, error: msg, code: "ELEMENT_NOT_FOUND" }
      return { ok: false, error: msg }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.7: `drag <ref|sel> <ref|sel>`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `drag`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("drag：10 步插值 mouseMoved", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  // source @e0 center (10,10)，target @e1 center (110,110)（第二个 ref 用不同 boxModel）
  let boxCallCount = 0
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "DOM.getBoxModel") {
      boxCallCount++
      return { model: { content: boxCallCount === 1 ? [0,0,20,0,20,20,0,20] : [100,100,120,100,120,120,100,120] } }
    }
    return ({}) as unknown
  }
  const r = await c.drag("@e0", "@e1")
  assert.equal(r.ok, true)
  const moved = t.calls.filter(([m, p]) => m === "Input.dispatchMouseEvent" && (p as { type?: string }).type === "mouseMoved")
  // 1 次 initial moveTo source + 10 步插值 = 11 次 mouseMoved
  assert.equal(moved.length, 11)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `drag`**

```typescript
  async drag(sourceRef: string, targetRef: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(sourceRef)
      const src = await this.resolveNode(sourceRef)
      if (!src) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      await this.scrollIntoView(targetRef)
      const tgt = await this.resolveNode(targetRef)
      if (!tgt) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const sx = src.center.x, sy = src.center.y
      const tx = tgt.center.x, ty = tgt.center.y
      await this.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: sx, y: sy })
      await this.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: sx, y: sy, button: "left", buttons: 1, clickCount: 1 })
      for (let i = 1; i <= 10; i++) {
        const cx = sx + (tx - sx) * i / 10
        const cy = sy + (ty - sy) * i / 10
        await this.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "left", buttons: 1 })
        await new Promise((r) => setTimeout(r, 10))
      }
      await this.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: tx, y: ty, button: "left", buttons: 0, clickCount: 1 })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.8: `upload <ref|sel> <file...>`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `upload`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

test("upload：文件不存在 → FILE_NOT_FOUND", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  const r = await c.upload("@e0", ["C:\\definitely-not-exists-12345.png"])
  assert.equal(r.ok, false)
  assert.equal(r.code, "FILE_NOT_FOUND")
})

test("upload：文件存在 → DOM.setFileInputFiles", async () => {
  const tmp = path.join(os.tmpdir(), `browserctl-upload-${Date.now()}.txt`)
  fs.writeFileSync(tmp, "hello")
  try {
    const t = mockTransport({
      "DOM.resolveNode": { object: { objectId: "obj-1" } },
      "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
      "Accessibility.getFullAXTree": { nodes: [
      { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
    ] },
      "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    })
    const c = new BrowserController(t)
    const r = await c.upload("@e0", [tmp])
    assert.equal(r.ok, true)
    assert.equal((r.data as { uploaded?: number }).uploaded, 1)
    const setFile = t.calls.filter(([m]) => m === "DOM.setFileInputFiles")
    assert.equal(setFile.length, 1)
  } finally {
    fs.unlinkSync(tmp)
  }
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `upload`**

在 `controller.ts` 顶部加 `import fs from "node:fs"`，然后加方法：

```typescript
  async upload(refOrSelector: string, files: string[]): Promise<CdpResult<{ uploaded: number }>> {
    try {
      const node = await this.resolveNode(refOrSelector)
      if (!node?.backendNodeId) return { ok: false, error: "ELEMENT_NOT_FOUND", code: "ELEMENT_NOT_FOUND" }
      const abs = files.map((f) => path.resolve(f))
      for (const f of abs) {
        if (!fs.existsSync(f)) return { ok: false, error: `file not found: ${f}`, code: "FILE_NOT_FOUND" }
      }
      await this.sendCommand("DOM.setFileInputFiles", {
        files: abs,
        backendNodeId: node.backendNodeId,
      })
      return { ok: true, data: { uploaded: abs.length } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

> 注：`controller.ts` 顶部已有 `import { buildRefs } ...`，加 `import fs from "node:fs"` 和 `import path from "node:path"`。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 1.9: bridge 路由 + `errorCode()` 扩展 + CLI 分发 + help

**Files:**
- Modify: `packages/browser-sdk/src/bridge.ts`（加 8 条路由 + 扩展 `errorCode`）
- Modify: `packages/browserctl/src/index.js`（加命令分支 + flag 解析 + help）
- Test: `packages/browser-sdk/test/controller.test.ts`（bridge 不单测，由 controller 单测覆盖逻辑）
- Test: `packages/browserctl/test/index.test.js`（加 CLI 分发测试）

- [ ] **Step 1: 扩展 `bridge.ts` 的 `errorCode()`**

在 `errorCode()` 函数的 `if` 链中加：

```typescript
  if (raw.includes("FILE_NOT_FOUND")) return "FILE_NOT_FOUND"
  if (raw.includes("NOT_CHECKABLE")) return "NOT_CHECKABLE"
```

- [ ] **Step 2: 在 `bridge.ts` 的 `switch (action)` 中加路由**

在 `fill` case 后追加 `hover / dblclick / focus / type / check / uncheck / drag / upload` 8 个 case。每个 case 结构仿 `click`：先 `ensureAttached`（catch → 503 BROWSER_UNAVAILABLE），取 `ref_or_selector` 等参数，调 controller 方法，回 `reply`。例如：

```typescript
      case "hover": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.hover(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

其余 7 个 case 完整实现如下（结构与 hover 一致：ensureAttached → 取参 → 调 controller → ELEMENT_NOT_FOUND 映 404 → reply）：

```typescript
      case "dblclick": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.dblclick(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "focus": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.focus(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "type": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const text = String(body.text ?? "")
        const result = await controller.type(refOrSelector, text)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "check":
      case "uncheck": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = action === "check"
          ? await controller.check(refOrSelector)
          : await controller.uncheck(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        if (!result.ok && result.code === "NOT_CHECKABLE") { reply(res, 422, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "drag": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const source = String(body.source ?? "")
        const target = String(body.target ?? "")
        if (!source || !target) { reply(res, 400, { ok: false, error: "source and target required", code: "BAD_REQUEST" }); return }
        const result = await controller.drag(source, target)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "upload": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const files = Array.isArray(body.files) ? body.files.map(String) : []
        if (!files.length) { reply(res, 400, { ok: false, error: "files required", code: "BAD_REQUEST" }); return }
        const result = await controller.upload(refOrSelector, files)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") { reply(res, 404, result); return }
        if (!result.ok && result.code === "FILE_NOT_FOUND") { reply(res, 404, result); return }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

> 注：`check/uncheck` 返回 `{ok, data:{checked: boolean}}`；`NOT_CHECKABLE` 用 422（语义错误）以与 404（元素不存在）区分。`upload` 的 `FILE_NOT_FOUND` 也映 404。

- [ ] **Step 3: 在 `browserctl/src/index.js` 的 `parseFlags` 加新 flag**

```javascript
    } else if (value === "--label") { ... }  // 已有
    // 新增（插在 --label 之后）
    } else if (value === "--url") {
      flags.url = argv[++i] || ""
    } else if (value === "--load") {
      flags.load = argv[++i] || ""
    } else if (value === "--fn") {
      flags.fn = argv[++i] || ""
    } else if (value === "--fn-file") {
      flags.fnFile = argv[++i] || ""
    } else if (value === "--fn-stdin") {
      flags.fnStdin = true
    } else if (value === "--state") {
      flags.state = argv[++i] || ""
    } else if (value === "--annotate") {
      flags.annotate = true
    } else if (value === "-c" || value === "--compact") {
      flags.compact = true
    } else if (value === "-d" || value === "--depth") {
      flags.depth = Number(argv[++i])
    } else if (value === "-s" || value === "--scope") {
      flags.scope = argv[++i] || ""
```

- [ ] **Step 4: 在 `browserctl/src/index.js` 加命令分支**

在 `click` 分支后加 `hover / dblclick / focus / type / check / uncheck / drag / upload` 分支：

```javascript
  if (command === "hover") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    print(await postAction("hover", { ref_or_selector: refOrSelector }), flags.pretty)
    return
  }
  if (command === "dblclick") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    print(await postAction("dblclick", { ref_or_selector: refOrSelector }), flags.pretty)
    return
  }
  if (command === "focus") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    print(await postAction("focus", { ref_or_selector: refOrSelector }), flags.pretty)
    return
  }
  if (command === "type") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const text = await resolveFillText(rest, flags) // 复用 fill 的 text 解析（支持 --text-file/--text-stdin）
    print(await postAction("type", { ref_or_selector: refOrSelector, text }), flags.pretty)
    return
  }
  if (command === "check" || command === "uncheck") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    print(await postAction(command, { ref_or_selector: refOrSelector }), flags.pretty)
    return
  }
  if (command === "drag") {
    const source = rest[0], target = rest[1]
    if (!source || !target) throw new Error("source and target required")
    print(await postAction("drag", { source, target }), flags.pretty)
    return
  }
  if (command === "upload") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const files = rest.slice(1)
    if (!files.length) throw new Error("at least one file path required")
    print(await postAction("upload", { ref_or_selector: refOrSelector, files }), flags.pretty)
    return
  }
```

- [ ] **Step 5: 更新 `usage()` help 文本**

在 `fill` 行后加：

```
  browserctl hover <@eN|selector> [--pretty]
  browserctl dblclick <@eN|selector> [--pretty]
  browserctl focus <@eN|selector> [--pretty]
  browserctl type <@eN|selector> (<text> | --text-file <path> | --text-stdin) [--pretty]
  browserctl check <@eN|selector> [--pretty]
  browserctl uncheck <@eN|selector> [--pretty]
  browserctl drag <@eN|selector> <@eN|selector> [--pretty]
  browserctl upload <@eN|selector> <file...> [--pretty]
```

- [ ] **Step 6: 写 CLI 分发测试**

在 `packages/browserctl/test/index.test.js` 加（仿现有模式，mock `postAction` 或用 `http` 拦截——按该文件现有风格）：

```javascript
test("hover 命令解析并分发到 hover 路由", async () => {
  // 按 index.test.js 现有的 mock bridge 模式
  // 断言 postAction 收到 { ref_or_selector: "@e0" } 且 action === "hover"
})
// 类似覆盖 dblclick/focus/type/check/uncheck/drag/upload
```

> 注：具体 mock 方式参照 `index.test.js` 现有测试的写法（该文件已存在）。

- [ ] **Step 7: 跑全部回归**

```bash
cd packages/browser-sdk && npx tsx --test test/*.test.ts
cd packages/browserctl && npx tsx --test test/index.test.js
cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts
```
Expected: 全 PASS。

---

### Task 1.10: 文档同步 + 提交

**Files:**
- Modify: `apps/server/build-in-skills/browser-runtime/reference.md`
- Modify: `apps/server/build-in-skills/browser-runtime/SKILL.md`
- Modify: `packages/browserctl/README.md`
- Modify: `packages/browserctl-cli/README.md`

- [ ] **Step 1: 更新 `reference.md`**

在命令清单加 8 条新命令（hover/dblclick/focus/type/check/uncheck/drag/upload），每条含：语法、参数、JSON 返回 envelope、错误码。在错误码表加 `FILE_NOT_FOUND`、`NOT_CHECKABLE`。在 `fill` 条目注明输入改用 `Input.insertText`。加 OOPIF annotate 注释（为 Batch 4 预留位，Batch 4 再填；此处只加交互命令）。

- [ ] **Step 2: 更新 `SKILL.md`**

在命令清单加 8 条新命令一行摘要。

- [ ] **Step 3: 更新 `packages/browserctl/README.md` 和 `packages/browserctl-cli/README.md`**

加 8 条新命令到命令清单。

- [ ] **Step 4: 提交 Batch 1**

```bash
cd d:\code\company\digital-employe-client-web-main
# 先把下方 `.git/COMMIT_MSG_B1 内容` 写入临时文件（PowerShell 无 heredoc，用 Write-Output + Set-Content -Encoding utf8）
Write-Output @"
feat(browserctl): Batch 1 交互命令对齐 agent-browser（hover/dblclick/focus/type/check/uncheck/drag/upload + fill 升级 insertText）

- fill 输入段改用 Input.insertText（保留 clearElement 原型 setter 清空，非破坏性）
- 新增 8 条交互命令，controller 显式带 code 字段
- bridge errorCode() 扩展 FILE_NOT_FOUND / NOT_CHECKABLE
- CLI 加命令分支 + flag 解析 + help
- 文档同步 reference.md / SKILL.md / README ×2
- 单测覆盖关键路径（insertText、mouseMoved、clickCount:2、focus、type printable/\\n、check 三步法、drag 10 步、upload FILE_NOT_FOUND）
"@ | Set-Content -Encoding utf8 .git/COMMIT_MSG_B1
git add packages/browser-sdk/src/controller.ts packages/browser-sdk/src/bridge.ts packages/browser-sdk/test/controller.test.ts
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git add apps/server/build-in-skills/browser-runtime/reference.md apps/server/build-in-skills/browser-runtime/SKILL.md
git add packages/browserctl/README.md packages/browserctl-cli/README.md
git commit -F .git/COMMIT_MSG_B1
Remove-Item .git/COMMIT_MSG_B1
```

`.git/COMMIT_MSG_B1` 内容：

```
feat(browserctl): Batch 1 交互命令对齐 agent-browser（hover/dblclick/focus/type/check/uncheck/drag/upload + fill 升级 insertText）

- fill 输入段改用 Input.insertText（保留 clearElement 原型 setter 清空，非破坏性）
- 新增 8 条交互命令，controller 显式带 code 字段
- bridge errorCode() 扩展 FILE_NOT_FOUND / NOT_CHECKABLE
- CLI 加命令分支 + flag 解析 + help
- 文档同步 reference.md / SKILL.md / README ×2
- 单测覆盖关键路径（insertText、mouseMoved、clickCount:2、focus、type printable/\\n、check 三步法、drag 10 步、upload FILE_NOT_FOUND）
```

---

## Batch 2 — wait 增强（4 条）+ 事件多路复用基础设施

### Task 2.1: controller 事件多路复用基础设施

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（构造函数加总 dispatcher + `addMessageListener`）
- Test: `packages/browser-sdk/test/controller.test.ts`（需增强 mock transport 支持 `on("message", cb)` + `emit`）

- [ ] **Step 1: 写失败测试**

```typescript
test("事件多路复用：addMessageListener pred 命中后 cb 调用，disposer 移除后不再触发", async () => {
  let onCb: ((method: string, params: unknown) => void) | null = null
  const t: Transport & { emit: (m: string, p: unknown) => void } = {
    calls: [],
    attach: async () => {},
    detach: async () => {},
    isAttached: () => true,
    on: (_ev: string, cb: (m: string, p: unknown) => void) => { onCb = cb },
    sendCommand: async (method, params) => { (t as { calls: Array<[string, unknown]> }).calls.push([method, params]); return {} },
    emit: (m, p) => { onCb?.(m, p) },
  }
  const c = new BrowserController(t)
  let hit = 0
  const dispose = c.addMessageListener(
    (m: string, _p: unknown) => m === "Page.lifecycleEvent",
    () => { hit++ }
  )
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(hit, 1)
  dispose()
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(hit, 1, "disposer 后不再触发")
})
```

> 注：`addMessageListener` 声明为 `public`（为可测性暴露，与 spec 一致）。测试直接 `c.addMessageListener(...)` 调用，无需 `as unknown` 强转。

- [ ] **Step 2: 跑测试确认失败** → FAIL（无 `addMessageListener`）。

- [ ] **Step 3: 实现**

`controller.ts`：

```typescript
export class BrowserController {
  private refCache: RefNode[] = []
  private messageListeners: Array<{ pred: (m: string, p: unknown) => boolean; cb: () => void }> = []

  constructor(private transport: Transport) {
    transport.on("message", (method: string, params: unknown) => {
      for (const l of this.messageListeners) {
        if (l.pred(method, params)) l.cb()
      }
    })
  }

  public addMessageListener(
    pred: (method: string, params: unknown, sessionId?: string) => boolean,
    cb: () => void
  ): () => void {
    const entry = { pred, cb }
    this.messageListeners.push(entry)
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== entry)
    }
  }
  // ... 其余方法不变
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

> ⚠️ 现有 `controller.test.ts` 的 `mockTransport` 的 `on: () => {}` 是空实现，构造函数注册的 dispatcher 不会出错，已有测试不受影响。但**确认现有 13 个测试仍 PASS**（构造时 `on` 被调用一次，无副作用）。

---

### Task 2.2: `wait --load networkidle`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（加 `waitForNetworkIdle`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写 3 个失败测试**

```typescript
test("waitForNetworkIdle：已 idle 短路（不发事件直接成功）", async () => {
  let evalCount = 0
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: true } }, // readyState complete + idle 启发式 true
  })
  const c = new BrowserController(t)
  const r = await c.waitForNetworkIdle(5000)
  assert.equal(r.ok, true)
})

test("waitForNetworkIdle：事件等待——发 networkIdle 后成功", async () => {
  let onCb: ((m: string, p: unknown) => void) | null = null
  const t: Transport & { emit: (m: string, p: unknown) => void } = {
    calls: [], attach: async () => {}, detach: async () => {}, isAttached: () => true,
    on: (_e, cb) => { onCb = cb },
    sendCommand: async (method, params) => { (t as { calls: Array<[string, unknown]> }).calls.push([method, params]); return {} },
    emit: (m, p) => { onCb?.(m, p) },
  }
  // 第一次 evaluate 返回 false（未 idle），之后监听事件
  let evalCount = 0
  t.sendCommand = async (method, params) => {
    (t as { calls: Array<[string, unknown]> }).calls.push([method, params])
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? false : true } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = c.waitForNetworkIdle(5000)
  await new Promise((r) => setTimeout(r, 50))
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  const result = await r
  assert.equal(result.ok, true)
})

test("waitForNetworkIdle：监听器移除——第二个事件不触发已 resolve 的 stale 回调", async () => {
  let onCb: ((m: string, params: unknown) => void) | null = null
  const t: Transport & { emit: (m: string, p: unknown) => void } = {
    calls: [], attach: async () => {}, detach: async () => {}, isAttached: () => true,
    on: (_e, cb) => { onCb = cb },
    sendCommand: async (method, params) => {
      (t as { calls: Array<[string, unknown]> }).calls.push([method, params])
      // 第一次 evaluate（idle 探测）返回 false，强制走事件路径
      if (method === "Runtime.evaluate") return { result: { value: false } }
      return {}
    },
    emit: (m, p) => { onCb?.(m, p) },
  }
  const c = new BrowserController(t)
  // 监听 disposer 语义：用一个独立 listener 记录 networkIdle 命中次数
  let outerHits = 0
  const outerDispose = c.addMessageListener(
    (m: string, p: unknown) => m === "Page.lifecycleEvent" && (p as { name?: string }).name === "networkIdle",
    () => { outerHits++ }
  )
  const r = c.waitForNetworkIdle(5000)
  await new Promise((r) => setTimeout(r, 30))
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })   // 触发 waitForNetworkIdle resolve
  await r
  // waitForNetworkIdle 内部 listener 应已自移除；再 emit 一次，外部 listener 仍会响应（证明 dispatcher 未被破坏）但不应有 stale 内部回调
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(outerHits, 2, "外部 listener 应两次响应")
  outerDispose()
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(outerHits, 2, "外部 disposer 后不再响应")
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `waitForNetworkIdle`**

```typescript
  async waitForNetworkIdle(timeoutMs = 10_000): Promise<CdpResult> {
    try {
      await this.sendCommand("Page.enable")
      await this.sendCommand("Network.enable")
      // 已就绪兜底：JS 侧 idle 启发式
      const probe = (await this.sendCommand("Runtime.evaluate", {
        expression: `(() => {
          if (document.readyState !== 'complete') return false;
          const entries = performance.getEntriesByType('resource');
          const last = entries.length ? entries[entries.length - 1].responseEnd : 0;
          return (performance.now() - last) > 500;
        })()`,
        returnByValue: true,
      })) as { result?: { value?: boolean } }
      if (probe.result?.value === true) return { ok: true }
      // 事件路径
      return await new Promise<CdpResult>((resolve) => {
        let done = false
        const timer = setTimeout(() => {
          if (done) return
          done = true
          dispose()
          resolve({ ok: false, error: "TIMEOUT", code: "TIMEOUT" })
        }, timeoutMs)
        const dispose = this.addMessageListener(
          (m, p) => m === "Page.lifecycleEvent" && (p as { name?: string }).name === "networkIdle",
          () => {
            if (done) return
            done = true
            clearTimeout(timer)
            dispose()
            resolve({ ok: true })
          }
        )
      })
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS（3 个测试）。

---

### Task 2.3: `wait --url` / `--fn` / `--state hidden`

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（扩展 `waitFor` 或加 `waitForUrl` / `waitForFunction` / `waitForState`）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("waitForUrl：glob 匹配", async () => {
  let evalCount = 0
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? "https://example.com/login" : "https://example.com/dashboard" } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.waitForUrl("https://example.com/dashboard", 5000)
  assert.equal(r.ok, true)
})

test("waitForFunction：return true 即满足", async () => {
  let evalCount = 0
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? false : true } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.waitForFunction("document.querySelector('.ready') !== null", 5000)
  assert.equal(r.ok, true)
})

test("waitForState hidden：元素 display:none 即满足", async () => {
  let evalCount = 0
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? false : true } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.waitForState("#modal", "hidden", 5000)
  assert.equal(r.ok, true)
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 3 个方法**

```typescript
  async waitForUrl(pattern: string, timeoutMs = 10_000): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$")
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", { expression: "window.location.href", returnByValue: true })) as { result?: { value?: string } }
        if (re.test(r.result?.value ?? "")) return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }

  async waitForFunction(js: string, timeoutMs = 10_000): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", { expression: js, returnByValue: true })) as { result?: { value?: boolean } }
        if (r.result?.value === true) return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }

  async waitForState(selector: string, state: "visible" | "hidden", timeoutMs = 10_000): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
    const expr = state === "hidden"
      ? `(() => { const el = document.querySelector('${escaped}'); if (!el) return true; const cs = getComputedStyle(el); return cs.display === 'none' || cs.visibility === 'hidden'; })()`
      : `!!document.querySelector('${escaped}')`
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", { expression: expr, returnByValue: true })) as { result?: { value?: boolean } }
        if (r.result?.value === true) return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 2.4: bridge `wait` 路由扩展 + CLI guard + fn 源归一

**Files:**
- Modify: `packages/browser-sdk/src/bridge.ts`（`wait` case 扩展参数）
- Modify: `packages/browserctl/src/index.js`（`wait` 分支扩展 guard + fn 源归一 + 调用新方法）
- Test: `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 扩展 `bridge.ts` 的 `wait` case**

把现有 `wait` case 改为支持新参数：

```typescript
      case "wait": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const selector = typeof body.selector === "string" ? body.selector : undefined
        const text = typeof body.text === "string" ? body.text : undefined
        const url = typeof body.url === "string" ? body.url : undefined
        const load = typeof body.load === "string" ? body.load : undefined
        const fn = typeof body.fn === "string" ? body.fn : undefined
        const state = typeof body.state === "string" ? body.state : undefined
        const timeoutMs = typeof body.timeout_ms === "number" ? body.timeout_ms : 10_000
        let result
        if (load === "networkidle") result = await controller.waitForNetworkIdle(timeoutMs)
        else if (url) result = await controller.waitForUrl(url, timeoutMs)
        else if (fn) result = await controller.waitForFunction(fn, timeoutMs)
        else if (selector && state) result = await controller.waitForState(selector, state, timeoutMs)
        else result = await controller.waitFor({ selector, text, timeoutMs })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

- [ ] **Step 2: 扩展 `browserctl/src/index.js` 的 `wait` 分支**

把现有 `wait` 分支改为：

```javascript
  if (command === "wait") {
    if (Number.isFinite(flags.ms)) {
      await sleep(Math.max(0, flags.ms))
      print({ ok: true, data: { waitedMs: flags.ms } }, flags.pretty)
      return
    }
    // fn 源归一：--fn-file > --fn-stdin > --fn（在 guard 之前，guard 只判 flags.fn）
    if (typeof flags.fnFile === "string" && flags.fnFile) {
      try {
        flags.fn = fs.readFileSync(flags.fnFile, "utf8").replace(/\r?\n$/, "")
      } catch (error) {
        throw new Error(`cannot read --fn-file ${flags.fnFile}: ${error.message}`)
      }
    } else if (flags.fnStdin) {
      flags.fn = (await readStdin()).replace(/\r?\n$/, "")
    }
    // --state 必须配 --selector
    if (flags.state && !flags.selector) {
      throw new Error("--state requires --selector")
    }
    // guard 扩展
    if (!flags.selector && !flags.text && !flags.url && !flags.load && !flags.fn) {
      throw new Error("wait requires one of --selector, --text, --ms, --url, --load or --fn")
    }
    print(
      await postAction("wait", {
        selector: flags.selector,
        text: flags.text,
        url: flags.url || undefined,
        load: flags.load || undefined,
        fn: flags.fn || undefined,
        state: flags.state || undefined,
        timeout_ms: Number.isFinite(flags.timeout) ? flags.timeout : 10000,
      }),
      flags.pretty
    )
    return
  }
```

- [ ] **Step 3: 更新 `usage()` 的 wait 行**

```
  browserctl wait (--selector <css> [--state visible|hidden] | --text <text> | --url <glob> | --load networkidle | --fn <js> | --fn-file <path> | --fn-stdin | --ms <n>) [--timeout 10000] [--pretty]
```

- [ ] **Step 4: 写 CLI 测试**

```javascript
test("wait --url 不再抛 requires --selector", async () => { /* 断言分发到 wait 路由，body.url 存在 */ })
test("wait --state 无 --selector 抛 --state requires --selector", async () => { /* 断言抛错 */ })
test("wait --fn-file 归一到 flags.fn", async () => { /* 写临时 JS 文件，断言 body.fn 等于文件内容 */ })
```

- [ ] **Step 5: 跑全部回归** → 全 PASS。

---

### Task 2.5: 文档同步 + 提交 Batch 2

**Files:**
- Modify: `apps/server/build-in-skills/browser-runtime/reference.md`
- Modify: `apps/server/build-in-skills/browser-runtime/SKILL.md`
- Modify: `packages/browserctl/README.md`
- Modify: `packages/browserctl-cli/README.md`

- [ ] **Step 1: 更新 `reference.md`** — `wait` 条目扩展 `--url/--load/--fn/--fn-file/--fn-stdin/--state`，加说明 + envelope + 错误码（TIMEOUT）。
- [ ] **Step 2: 更新 `SKILL.md`** — `wait` 一行加新 flag 摘要。
- [ ] **Step 3: 更新两个 README** — `wait` 命令清单加新 flag。
- [ ] **Step 4: 提交**

```bash
Write-Output @"
feat(browserctl): Batch 2 wait 增强（--url/--load networkidle/--fn/--state hidden）+ 事件多路复用基础设施

- controller 构造时注册总 transport.on("message", dispatcher)，addMessageListener(pred, cb) 返回 disposer
- waitForNetworkIdle：已就绪 JS 启发式短路 + Page.lifecycleEvent networkIdle 事件路径
- waitForUrl（glob）/ waitForFunction（轮询）/ waitForState（visible|hidden）
- bridge wait 路由扩展，CLI guard 扩为 --url|--load|--fn，--state 需 --selector
- fn 源归一：--fn-file > --fn-stdin > --fn（guard 之前）
- 单测：事件多路复用 disposer 语义、networkidle 已 idle 短路 + 事件等待 + 监听器移除、3 个 wait 变体
"@ | Set-Content -Encoding utf8 .git/COMMIT_MSG_B2
git add packages/browser-sdk/src/controller.ts packages/browser-sdk/src/bridge.ts packages/browser-sdk/test/controller.test.ts
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git add apps/server/build-in-skills/browser-runtime/reference.md apps/server/build-in-skills/browser-runtime/SKILL.md
git add packages/browserctl/README.md packages/browserctl-cli/README.md
git commit -F .git/COMMIT_MSG_B2
Remove-Item .git/COMMIT_MSG_B2
```

`COMMIT_MSG_B2`：

```
feat(browserctl): Batch 2 wait 增强（--url/--load networkidle/--fn/--state hidden）+ 事件多路复用基础设施

- controller 构造时注册总 transport.on("message", dispatcher)，addMessageListener(pred, cb) 返回 disposer
- waitForNetworkIdle：已就绪 JS 启发式短路 + Page.lifecycleEvent networkIdle 事件路径
- waitForUrl（glob）/ waitForFunction（轮询）/ waitForState（visible|hidden）
- bridge wait 路由扩展，CLI guard 扩为 --url|--load|--fn，--state 需 --selector
- fn 源归一：--fn-file > --fn-stdin > --fn（guard 之前）
- 单测：事件多路复用 disposer 语义、networkidle 已 idle 短路 + 事件等待 + 监听器移除、3 个 wait 变体
```

---

## Batch 3 — snapshot 过滤（3 条）

### Task 3.1: `ax-tree.buildRefs` 加 compact/depth/scope 选项

**Files:**
- Modify: `packages/browser-sdk/src/ax-tree.ts`（`buildRefs` 签名扩展）
- Modify: `packages/browser-sdk/src/controller.ts`（`snapshot` 传选项 + scope 用 `getChildAXTree`）
- Test: `packages/browser-sdk/test/ax-tree.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("buildRefs compact 丢弃 null name/value，保留 ref/role/backendNodeId/depth", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2", "3"] },
    { nodeId: "2", role: { value: "button" }, name: { value: "Submit" } },
    { nodeId: "3", role: { value: "generic" } }, // 无 name/value
  ]
  const refs = buildRefs([nodes], 200, { compact: true })
  // @e1 RootWebArea, @e2 button "Submit", @e3 generic（compact 仍保留但 name/value 字段为 undefined 而非 null）
  const e3 = refs.find((r) => r.role === "generic")
  assert.ok(e3)
  // compact：null 字段被裁剪（在序列化时为 undefined，JSON.stringify 会丢弃）
  assert.equal(e3.name, undefined)
  assert.equal(e3.value, undefined)
})

test("buildRefs maxDepth 限深", () => {
  const nodes = [
    { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
    { nodeId: "2", role: { value: "button" }, name: { value: "A" }, childIds: ["3"] },
    { nodeId: "3", role: { value: "button" }, name: { value: "B" } },
  ]
  const refs = buildRefs([nodes], 200, { maxDepth: 1 })
  // depth 0: RootWebArea, depth 1: button A；depth 2: button B 被剪
  assert.ok(refs.some((r) => r.role === "RootWebArea"))
  assert.ok(refs.some((r) => r.name === "A"))
  assert.ok(!refs.some((r) => r.name === "B"))
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL（`buildRefs` 第 3 参数未支持）。

- [ ] **Step 3: 扩展 `buildRefs`**

```typescript
export function buildRefs(
  framesNodes: unknown[][],
  maxNodes: number,
  opts: { compact?: boolean; maxDepth?: number; scopeSelector?: string } = {}
): RefNode[] {
  const { compact = false, maxDepth, scopeSelector } = opts
  const refs: RefNode[] = []
  let counter = 0

  const walkFrame = (nodes: unknown[]) => {
    const nodeMap = new Map<string, AxNode>()
    for (const n of nodes) {
      const node = n as AxNode
      if (node.nodeId != null) nodeMap.set(String(node.nodeId), node)
    }
    const walk = (node: AxNode, depth: number) => {
      if (refs.length >= maxNodes) return
      if (maxDepth !== undefined && depth > maxDepth) return
      // ... 原有 ignored / MASKED_ROLES / presentation 逻辑不变
      // push 时：
      refs.push({
        ref: `@e${counter++}`,
        role,
        name: compact ? (node.name?.value ?? undefined) : (node.name?.value ?? null),
        value: compact ? (node.value?.value ?? undefined) : (node.value?.value ?? null),
        backendNodeId: node.backendDOMNodeId ?? 0,
        depth,
      })
      // ... childIds 遍历不变
    }
    // ... root 查找不变
  }
  // scopeSelector 在 controller 层处理（getChildAXTree），buildRefs 只负责 compact/maxDepth
  for (const nodes of framesNodes) {
    if (refs.length >= maxNodes) break
    walkFrame(nodes)
  }
  return refs
}
```

> 注：`RefNode` 的 `name/value` 类型改为 `string | null | undefined`（compact 时 undefined）。需同步更新 `RefNode` interface。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 3.2: controller `snapshot` 支持 scope + 传选项

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（`snapshot` 加参数 + scope 分支）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("snapshot scope 用 Accessibility.getChildAXTree", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "DOM.querySelector": { nodeId: 100 },
    "DOM.requestNode": { nodeId: 100 },
    "Accessibility.getChildAXTree": { nodes: [{ nodeId: "10", role: { value: "button" }, name: { value: "OK" } }] },
  })
  const c = new BrowserController(t)
  const r = await c.snapshot(200, { scopeSelector: "#modal" })
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getChildAXTree"))
})

test("snapshot scope 回退：getChildAXTree 抛错 → getFullAXTree", async () => {
  const t = mockTransport({
    "DOM.querySelector": { nodeId: 100 },
    "Accessibility.getFullAXTree": { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  // 让 getChildAXTree 抛错，强制走 getFullAXTree 回退
  const orig = t.sendCommand
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Accessibility.getChildAXTree") throw new Error("not supported")
    if (method === "Accessibility.getFullAXTree") return { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }] }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.snapshot(200, { scopeSelector: "#modal" })
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getChildAXTree"))
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getFullAXTree"), "回退到 getFullAXTree")
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 扩展 `snapshot`**

```typescript
  async snapshot(
    maxNodes = 200,
    opts: { compact?: boolean; maxDepth?: number; scopeSelector?: string } = {}
  ): Promise<CdpResult<{ refs: RefNode[] }>> {
    try {
      await this.sendCommand("Accessibility.enable")
      let framesNodes: unknown[][] = []

      if (opts.scopeSelector) {
        // scope 分支：主 frame 用 getChildAXTree
        const escaped = opts.scopeSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
        const q = (await this.sendCommand("DOM.querySelector", { selector: opts.scopeSelector })) as { nodeId?: number }
        if (q.nodeId) {
          try {
            const r = (await this.sendCommand("Accessibility.getChildAXTree", { nodeId: q.nodeId })) as { nodes?: unknown[] }
            framesNodes.push(r.nodes ?? [])
          } catch {
            // 回退：getFullAXTree + 按 backendNodeId 子树过滤（简化：直接整树，让 maxNodes 兜底）
            const r = (await this.sendCommand("Accessibility.getFullAXTree")) as { nodes?: unknown[] }
            framesNodes.push(r.nodes ?? [])
          }
        } else {
          const r = (await this.sendCommand("Accessibility.getFullAXTree")) as { nodes?: unknown[] }
          framesNodes.push(r.nodes ?? [])
        }
      } else {
        // 原有逻辑抽成 helper，避免重复（主 frame 惰性轮询 + 子 frame 收集）
        framesNodes = await this.collectFullSnapshotFrames()
      }

      const refs = buildRefs(framesNodes, maxNodes, opts)
      this.refCache = refs
      return { ok: true, data: { refs } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

> 注：`collectFullSnapshotFrames()` 是把现有 `snapshot` 主体（主 frame 惰性轮询 RootWebArea 子节点 + `Page.getFrameTree` 收集子 frame、跨源 OOPIF 静默跳过）抽出的 `private async collectFullSnapshotFrames(): Promise<unknown[][]>`，返回各 frame 的 nodes 数组。`-s` 仅作用于主 frame，iframe 子树仍按现有逻辑收集（scope 分支不收集子 frame，与 spec 一致）。

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 3.3: bridge `snapshot` 路由扩展 + CLI flag

**Files:**
- Modify: `packages/browser-sdk/src/bridge.ts`（`snapshot` case 传新参数）
- Modify: `packages/browserctl/src/index.js`（`snapshot` 分支传 flag）
- Test: `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 扩展 `bridge.ts` `snapshot` case**

```typescript
      case "snapshot": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const maxNodes = typeof body.max_nodes === "number" ? body.max_nodes : 200
        const compact = Boolean(body.compact)
        const maxDepth = typeof body.max_depth === "number" ? body.max_depth : undefined
        const scopeSelector = typeof body.scope_selector === "string" ? body.scope_selector : undefined
        const result = await controller.snapshot(maxNodes, { compact, maxDepth, scopeSelector })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

- [ ] **Step 2: 扩展 `browserctl/src/index.js` `snapshot` 分支**

```javascript
  if (command === "snapshot") {
    const result = await postAction("snapshot", {
      max_nodes: Number.isFinite(flags.maxNodes) ? flags.maxNodes : 200,
      compact: Boolean(flags.compact),
      max_depth: Number.isFinite(flags.depth) ? flags.depth : undefined,
      scope_selector: flags.scope || undefined,
    })
    // ... 现有 tree/interactive 渲染逻辑保留
    print(result, flags.pretty)
    return
  }
```

- [ ] **Step 3: 更新 `usage()` 的 snapshot 行**

```
  browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree | --interactive] [--pretty]
```

- [ ] **Step 4: 写 CLI 测试** — 断言 `snapshot -c -d 2 -s "#main"` 传 `compact:true, max_depth:2, scope_selector:"#main"`。
- [ ] **Step 5: 跑全部回归** → 全 PASS。

---

### Task 3.4: 文档同步 + 提交 Batch 3

- [ ] **Step 1: 更新 `reference.md`** — `snapshot` 条目加 `-c/-d/-s` 说明 + envelope。
- [ ] **Step 2: 更新 `SKILL.md` + 两个 README**。
- [ ] **Step 3: 提交**

```bash
cd d:\code\company\digital-employe-client-web-main
Write-Output @"
feat(browserctl): Batch 3 snapshot 过滤 (--compact/-c、--depth/-d、--scope/-s)

- buildRefs 加 compact/maxDepth 选项（compact 丢弃 null name/value）
- snapshot scope 用 DOM.querySelector + Accessibility.getChildAXTree，失败回退 getFullAXTree
- bridge + CLI 传新参数，--max-nodes 与 -c/-d/-s 可组合
- 单测：compact 裁剣、maxDepth 限深、scope getChildAXTree + 回退
"@ | Set-Content -Encoding utf8 .git/COMMIT_MSG_B3
git add packages/browser-sdk/src/ax-tree.ts packages/browser-sdk/src/controller.ts packages/browser-sdk/src/bridge.ts
git add packages/browser-sdk/test/ax-tree.test.ts packages/browser-sdk/test/controller.test.ts
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git add apps/server/build-in-skills/browser-runtime/reference.md apps/server/build-in-skills/browser-runtime/SKILL.md
git add packages/browserctl/README.md packages/browserctl-cli/README.md
git commit -F .git/COMMIT_MSG_B3
Remove-Item .git/COMMIT_MSG_B3
```

---

## Batch 4 — screenshot --annotate

### Task 4.1: controller `screenshot` 支持 annotate

**Files:**
- Modify: `packages/browser-sdk/src/controller.ts`（`screenshot` 加 `annotate` 选项 + overlay 注入/移除）
- Test: `packages/browser-sdk/test/controller.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
test("screenshot --annotate：注入 overlay、captureBeyondViewport:true、移除 overlay", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } },
    "Accessibility.getFullAXTree": { nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] }, { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 1 }] },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": { result: { value: { x: 0, y: 0, width: 100, height: 50 } } },
    "Runtime.evaluate": { result: { value: true } },
    "Page.captureScreenshot": { data: "iVBOR" },
  })
  const c = new BrowserController(t)
  // 先 snapshot 填 refCache
  await c.snapshot(200)
  const r = await c.screenshot({ annotate: true })
  assert.equal(r.ok, true)
  assert.ok((r.data as { annotations?: unknown[] }).annotations)
  // captureBeyondViewport:true
  const shot = t.calls.filter(([m]) => m === "Page.captureScreenshot")
  assert.equal(shot.length, 1)
  assert.equal((shot[0][1] as { captureBeyondViewport?: boolean }).captureBeyondViewport, true)
  // overlay 注入 + 移除
  const evals = t.calls.filter(([m]) => m === "Runtime.evaluate")
  assert.ok(evals.some(([, p]) => String((p as { expression?: string }).expression).includes("__browserctl_annotations__")))
  assert.ok(evals.some(([, p]) => String((p as { expression?: string }).expression).includes("remove()")))
})

test("screenshot --annotate：OOPIF ref 抛错时静默跳过", async () => {
  // 两个 ref：@e0(RootWebArea, resolveNode OK) @e1(OOPIF, DOM.resolveNode 抛错)
  const t = mockTransport({
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": { result: { value: { x: 0, y: 0, width: 100, height: 50 } } },
    "Runtime.evaluate": { result: { value: true } },
    "Page.captureScreenshot": { data: "iVBOR" },
  })
  let resolveCount = 0
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Accessibility.getFullAXTree") {
      return { nodes: [
        { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
        { nodeId: "2", role: { value: "button" }, name: { value: "OK" }, backendDOMNodeId: 2 },
      ] }
    }
    if (method === "DOM.resolveNode") {
      resolveCount++
      // 第二次（@e1, backendNodeId 2）抛错模拟 OOPIF
      if (resolveCount === 2) throw new Error("Cannot find object for given backendNodeId")
      return { object: { objectId: "obj-1" } }
    }
    if (method === "Runtime.callFunctionOn") return { result: { value: { x: 0, y: 0, width: 100, height: 50 } } }
    if (method === "Runtime.evaluate") return { result: { value: true } }
    if (method === "Page.captureScreenshot") return { data: "iVBOR" }
    return {}
  }
  const c = new BrowserController(t)
  await c.snapshot(200)              // 填 refCache（@e0, @e1）
  const r = await c.screenshot({ annotate: true })
  assert.equal(r.ok, true, "OOPIF 抛错不应中断整个 annotate")
  const anns = (r.data as { annotations?: Array<{ ref: string }> }).annotations ?? []
  assert.ok(anns.some((a) => a.ref === "@e0"), "@e0 仍被标注")
  assert.ok(!anns.some((a) => a.ref === "@e1"), "@e1(OOPIF) 应被跳过")
  // overlay 仍注入并移除
  const evals = t.calls.filter(([m]) => m === "Runtime.evaluate")
  assert.ok(evals.some(([, p]) => String((p as { expression?: string }).expression).includes("__browserctl_annotations__")))
})
```

- [ ] **Step 2: 跑测试确认失败** → FAIL。

- [ ] **Step 3: 实现 `screenshot({annotate})`**

```typescript
  async screenshot(opts: { annotate?: boolean } = {}): Promise<CdpResult<{ base64: string; annotations?: Array<{ ref: string; number: number; role: string; name?: string; box: { x: number; y: number; width: number; height: number } }> }>> {
    try {
      let annotations: Array<{ ref: string; number: number; role: string; name?: string; box: { x: number; y: number; width: number; height: number } }> = []
      if (opts.annotate) {
        if (!this.refCache.length) await this.snapshot()
        const items: Array<{ number: number; x: number; y: number; width: number; height: number; role: string; name?: string; ref: string }> = []
        for (const ref of this.refCache) {
          try {
            if (!ref.backendNodeId) continue
            const resolved = (await this.sendCommand("DOM.resolveNode", { backendNodeId: ref.backendNodeId })) as { object?: { objectId?: string } }
            if (!resolved.object?.objectId) continue
            const r = (await this.sendCommand("Runtime.callFunctionOn", {
              objectId: resolved.object.objectId,
              functionDeclaration: "function(){ const r=this.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; }",
              returnByValue: true,
            })) as { result?: { value?: { x: number; y: number; width: number; height: number } } }
            const box = r.result?.value
            if (!box || box.width <= 0 || box.height <= 0) continue
            const num = Number(ref.ref.slice(2))
            items.push({ number: num, x: box.x, y: box.y, width: box.width, height: box.height, role: ref.role, name: ref.name ?? undefined, ref: ref.ref })
          } catch {
            // OOPIF 跨源 iframe ref 在主 session 抛错——静默跳过
            continue
          }
        }
        items.sort((a, b) => a.number - b.number)
        annotations = items.map((it) => ({ ref: it.ref, number: it.number, role: it.role, name: it.name, box: { x: it.x, y: it.y, width: it.width, height: it.height } }))
        // 注入 overlay
        const itemsJson = JSON.stringify(items)
        await this.sendCommand("Runtime.evaluate", {
          expression: `(() => {
            const items = ${itemsJson}; const id = "__browserctl_annotations__";
            document.getElementById(id)?.remove();
            const sx = window.scrollX||0, sy = window.scrollY||0;
            const c = document.createElement('div');
            c.id = id; c.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647';
            for (const it of items) {
              const dx = it.x+sx, dy = it.y+sy;
              const b = document.createElement('div');
              b.style.cssText = 'position:absolute;left:'+dx+'px;top:'+dy+'px;width:'+it.width+'px;height:'+it.height+'px;border:2px solid rgba(255,0,0,0.8);box-sizing:border-box;pointer-events:none;';
              const l = document.createElement('div');
              l.textContent = String(it.number);
              l.style.cssText = 'position:absolute;top:'+(dy<14?'2px':'-14px')+';left:-2px;background:rgba(255,0,0,0.9);color:#fff;font:bold 11px/14px monospace;padding:0 4px;border-radius:2px;white-space:nowrap;';
              b.appendChild(l); c.appendChild(b);
            }
            document.documentElement.appendChild(c); return true;
          })()`,
        })
      }
      const result = (await this.sendCommand("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      })) as { data?: string }
      if (opts.annotate) {
        await this.sendCommand("Runtime.evaluate", {
          expression: "document.getElementById('__browserctl_annotations__')?.remove()",
        })
      }
      return { ok: true, data: { base64: result.data ?? "", annotations } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过** → PASS。

---

### Task 4.2: bridge `screenshot` 路由扩展 + CLI flag + 落盘

**Files:**
- Modify: `packages/browser-sdk/src/bridge.ts`（`screenshot` case 传 `annotate`）
- Modify: `packages/browserctl/src/index.js`（`screenshot` 分支传 `annotate` + 返回 annotations）
- Test: `packages/browserctl/test/index.test.js`

- [ ] **Step 1: 扩展 `bridge.ts` `screenshot` case**

```typescript
      case "screenshot": {
        try { await host.ensureAttached() } catch { reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE", code: "BROWSER_UNAVAILABLE" }); return }
        const annotate = Boolean(body.annotate)
        const result = await controller.screenshot({ annotate })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
```

- [ ] **Step 2: 扩展 `browserctl/src/index.js` `screenshot` 分支**

```javascript
  if (command === "screenshot") {
    const result = await postAction("screenshot", { annotate: Boolean(flags.annotate) })
    if (!result.ok) { print(result, flags.pretty); return }
    const base64 = result.data && result.data.base64 ? result.data.base64 : ""
    if (!base64) { print({ ok: false, error: "empty screenshot data", code: "EMPTY_SCREENSHOT" }, flags.pretty); return }
    const outPath = flags.out ? path.resolve(flags.out) : path.resolve(`browser-screenshot-${Date.now()}.png`)
    try { fs.writeFileSync(outPath, Buffer.from(base64, "base64")) } catch (error) { print({ ok: false, error: `cannot write screenshot to ${outPath}: ${error.message}`, code: "WRITE_FAILED" }, flags.pretty); return }
    print({ ok: true, data: { path: outPath, bytes: fs.statSync(outPath).size, annotations: result.data.annotations || [] } }, flags.pretty)
    return
  }
```

- [ ] **Step 3: 更新 `usage()` 的 screenshot 行**

```
  browserctl screenshot [--annotate] [--out <path>] [--pretty]
```

- [ ] **Step 4: 写 CLI 测试** — 断言 `screenshot --annotate` 传 `annotate:true`，返回含 `annotations` 数组。
- [ ] **Step 5: 跑全部回归** → 全 PASS。

---

### Task 4.3: 文档同步 + 提交 Batch 4

- [ ] **Step 1: 更新 `reference.md`** — `screenshot` 条目加 `--annotate`，envelope 加 `annotations:[{ref,number,role,name?,box:{x,y,width,height}}]`，加 OOPIF 跨源 iframe 注释（「OOPIF 跨源 iframe 的 @eN 不参与 annotate」）。
- [ ] **Step 2: 更新 `SKILL.md` + 两个 README**。
- [ ] **Step 3: 提交**

```bash
cd d:\code\company\digital-employe-client-web-main
Write-Output @"
feat(browserctl): Batch 4 screenshot --annotate (CSS overlay 注入法)

- controller screenshot 加 annotate 选项：逐 ref try/catch 取 bbox（OOPIF 静默跳过）
- 注入 __browserctl_annotations__ overlay，Page.captureScreenshot captureBeyondViewport:true，再移除 overlay
- 返回 {base64, annotations:[{ref,number,role,name?,box}]}
- bridge + CLI 传 annotate，落盘后返回 annotations 数组
- 单测：overlay 注入/移除调用序列、captureBeyondViewport:true、OOPIF ref 静默跳过
- reference.md 注明 OOPIF 跨源 iframe 的 @eN 不参与 annotate
"@ | Set-Content -Encoding utf8 .git/COMMIT_MSG_B4
git add packages/browser-sdk/src/controller.ts packages/browser-sdk/src/bridge.ts packages/browser-sdk/test/controller.test.ts
git add packages/browserctl/src/index.js packages/browserctl/test/index.test.js
git add apps/server/build-in-skills/browser-runtime/reference.md apps/server/build-in-skills/browser-runtime/SKILL.md
git add packages/browserctl/README.md packages/browserctl-cli/README.md
git commit -F .git/COMMIT_MSG_B4
Remove-Item .git/COMMIT_MSG_B4
```

---

## 最终验收

### Task 5.1: 端到端冒烟

- [ ] **Step 1: 启动 daemon / Electron dev**

```bash
# 独立 daemon
cd packages/browserctl-daemon && node dist/cli.js serve
# 或 Electron dev
pnpm --filter digital-employee dev:app
```

- [ ] **Step 2: 跑 baidu 冒烟**

```bash
node packages/browserctl/src/index.js open https://www.baidu.com
node packages/browserctl/src/index.js snapshot --interactive
# 用 @eN 跑：fill / type / hover / dblclick / check / screenshot --annotate
node packages/browserctl/src/index.js fill @eN "关键词"
node packages/browserctl/src/index.js get value @eN   # 期望 "关键词"
node packages/browserctl/src/index.js screenshot --annotate --out baidu.png
# 检查 baidu.png 有红色标注框 + 数字标签
```

- [ ] **Step 3: 跑 wait --load networkidle 在慢页面**

```bash
node packages/browserctl/src/index.js open https://www.taobao.com
node packages/browserctl/src/index.js wait --load networkidle --timeout 30000
# 期望 ok:true
```

- [ ] **Step 4: 跑全量回归**

```bash
cd packages/browser-sdk && npx tsx --test test/*.test.ts
cd packages/browserctl && npx tsx --test test/index.test.js
cd packages/browserctl-daemon && npx tsx --test test/chrome-transport.test.ts test/standalone-host.test.ts
pnpm typecheck
pnpm lint
```
Expected: 全 PASS / 无 lint 错误。

---

### Task 5.2: finishing-a-development-branch 合回 dev

- [ ] **Step 1: 用 superpowers:finishing-a-development-branch skill 合并 `feat/browserctl-align-agent-browser` 回 `dev`**

```bash
# fast-forward 合并（按 skill 指引）
git checkout dev
git merge --ff-only feat/browserctl-align-agent-browser
```

- [ ] **Step 2: 验证 dev 上全量回归** → PASS。

---

## 验收标准（与 spec §8 对齐）

- [ ] 4 个 batch 全部落地，4 处同步无遗漏（controller + bridge + CLI + 文档）
- [ ] `browser-sdk` + `browserctl-daemon` 回归全绿
- [ ] `browserctl --help` 列出全部新命令
- [ ] 真实页面冒烟：baidu 搜索框 `fill`/`type`/`hover`/`dblclick`/`check`/`screenshot --annotate` 跑通
- [ ] `wait --load networkidle` 在慢页面生效
- [ ] `reference.md` 与 `--help` 一致

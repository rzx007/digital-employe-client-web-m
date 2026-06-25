# browserctl 高频命令(press / scroll / select / get value-attr)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。Steps 用 `- [ ]` 跟踪。

**Goal:** 给 browserctl 补四个 agent-browser 同款高频命令——`press`(键盘)、`scroll`(滚动 + click 前自动 scrollIntoView)、`select`(下拉)、`get value/attr`(读元素值),覆盖企业表单操作的高频空白。

**Architecture:** 三层一致:`browser-debugger-controller.ts` 加 CDP 方法 → `browser-http-bridge.ts` 加 action → `packages/browserctl/src/index.js` 加命令。browserctl 命令层用 node:test 测(命令→正确的 bridge action+payload);CDP 实现层靠 typecheck + 手动 E2E(Electron 内 CDP 无法单测)。

**Tech Stack:** Electron `webContents.debugger`(CDP)、Node CLI(node:test)。

---

## 通用基建(各 task 复用)

`browser-debugger-controller.ts` 现有 `fill` 的清空逻辑里已有"@eN → DOM.resolveNode+callFunctionOn;selector → Runtime.evaluate(querySelector)"的定位套路。**Task 3 起抽出一个复用 helper**:

```ts
/** 在 refOrSelector 指向的元素上执行一段 JS（this=元素），返回 returnByValue 结果。 */
private async runOnElement(
  refOrSelector: string,
  funcBody: string  // 函数体，用 el 引用元素，可 return
): Promise<unknown> {
  const nodeInfo = await this.resolveNode(refOrSelector)
  if (!nodeInfo) throw new Error("ELEMENT_NOT_FOUND")
  if (nodeInfo.backendNodeId) {
    const resolved = (await this.sendCommand("DOM.resolveNode", {
      backendNodeId: nodeInfo.backendNodeId,
    })) as { object?: { objectId?: string } }
    const objectId = resolved.object?.objectId
    if (!objectId) throw new Error("ELEMENT_NOT_FOUND")
    const r = (await this.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: `function(){ const el=this; ${funcBody} }`,
      returnByValue: true,
    })) as { result?: { value?: unknown } }
    return r.result?.value
  }
  const escaped = refOrSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  const r = (await this.sendCommand("Runtime.evaluate", {
    expression: `(()=>{ const el=document.querySelector('${escaped}'); if(!el) return null; ${funcBody} })()`,
    returnByValue: true,
  })) as { result?: { value?: unknown } }
  return r.result?.value
}
```
> 实现 Task 3 时把它加进 controller,并可顺手让现有 `clearElement` 复用它(可选,别破坏 fill)。

browserctl `test/index.test.js` 已有 helper:`startServer`/`runCli`/`urlOf`/`readBody`/`closeServer`。新命令测试照搬模式(mock bridge 收 body,断言 action 路径 + payload)。

---

## Task 1: press 键盘按键

**Files:** Modify `browser-debugger-controller.ts`、`browser-http-bridge.ts`、`packages/browserctl/src/index.js`、`packages/browserctl/test/index.test.js`

- [ ] **Step 1: 写失败测试**(browserctl 命令→bridge payload)

```javascript
test("press 发送 key + modifiers 到 press action", async () => {
  let reqUrl, body
  const srv = await startServer(async (req, res) => {
    reqUrl = req.url; body = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["press", "Enter"], { env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.ok(reqUrl.endsWith("/press"))
    assert.equal(body.key, "Enter")
    assert.deepEqual(body.modifiers, {})
  } finally { await closeServer(srv) }
})

test("press 带 ref 与修饰键", async () => {
  let body
  const srv = await startServer(async (req, res) => {
    body = JSON.parse(await readBody(req)); res.end(JSON.stringify({ ok: true }))
  })
  try {
    await runCli(["press", "a", "@e4", "--ctrl", "--shift"], { env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.equal(body.key, "a")
    assert.equal(body.ref_or_selector, "@e4")
    assert.equal(body.modifiers.ctrl, true)
    assert.equal(body.modifiers.shift, true)
  } finally { await closeServer(srv) }
})
```

- [ ] **Step 2: 跑失败** `cd packages/browserctl && node --test` → 新用例 FAIL

- [ ] **Step 3: browserctl 命令**(index.js)
  - parseFlags 加 `--ctrl/--shift/--alt/--meta`(布尔)
  - usage 加 `browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta]`
  - run() 加:
    ```javascript
    if (command === "press") {
      const key = rest[0]
      if (!key) throw new Error("key required")
      // rest[1] 可选为 @eN/selector
      const refOrSelector = rest[1]
      const modifiers = {}
      if (flags.ctrl) modifiers.ctrl = true
      if (flags.shift) modifiers.shift = true
      if (flags.alt) modifiers.alt = true
      if (flags.meta) modifiers.meta = true
      print(await postAction("press", { key, ref_or_selector: refOrSelector, modifiers }), flags.pretty)
      return
    }
    ```

- [ ] **Step 4: bridge action**(browser-http-bridge.ts,仿 fill 那个 case)
  ```ts
  case "press": {
    if (!attachDebugger()) { reply(res, 503, { ok:false, error:"BROWSER_UNAVAILABLE" }); return }
    const key = String(body.key ?? "")
    const refOrSelector = typeof body.ref_or_selector === "string" ? body.ref_or_selector : undefined
    const m = (body.modifiers ?? {}) as Record<string, boolean>
    const result = await dbg.press(key, m, refOrSelector)
    reply(res, result.ok ? 200 : 502, result)
    return
  }
  ```

- [ ] **Step 5: debugger 方法 + KEY_MAP**(browser-debugger-controller.ts)
  ```ts
  // 模块顶部
  const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> = {
    Enter: { key: "Enter", code: "Enter", keyCode: 13 },
    Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    Escape: { key: "Escape", code: "Escape", keyCode: 27 },
    Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
    Delete: { key: "Delete", code: "Delete", keyCode: 46 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
    ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  }
  function resolveKey(key: string) {
    if (KEY_MAP[key]) return KEY_MAP[key]
    if (key.length === 1) {
      const ch = key
      const code = /[a-z]/i.test(ch) ? `Key${ch.toUpperCase()}`
        : /[0-9]/.test(ch) ? `Digit${ch}` : ""
      return { key: ch, code, keyCode: ch.toUpperCase().charCodeAt(0) }
    }
    return { key, code: "", keyCode: 0 }
  }
  // CDP modifiers bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
  function modBits(m: Record<string, boolean>): number {
    return (m.alt?1:0) | (m.ctrl?2:0) | (m.meta?4:0) | (m.shift?8:0)
  }
  ```
  方法:
  ```ts
  async press(key: string, modifiers: Record<string, boolean>, refOrSelector?: string): Promise<CdpResult> {
    try {
      if (refOrSelector) {
        // 先聚焦:复用 click 的定位+点击(或 DOM.focus)
        const node = await this.resolveNode(refOrSelector)
        if (node) {
          await this.sendCommand("Input.dispatchMouseEvent", { type:"mousePressed", x:node.center.x, y:node.center.y, button:"left", clickCount:1 })
          await this.sendCommand("Input.dispatchMouseEvent", { type:"mouseReleased", x:node.center.x, y:node.center.y, button:"left", clickCount:1 })
        }
      }
      const k = resolveKey(key)
      const mods = modBits(modifiers)
      await this.sendCommand("Input.dispatchKeyEvent", { type:"keyDown", key:k.key, code:k.code, windowsVirtualKeyCode:k.keyCode, modifiers:mods })
      // 可打印单字符且无 ctrl/alt/meta → 补 char 事件以真正输入
      if (key.length === 1 && !modifiers.ctrl && !modifiers.alt && !modifiers.meta) {
        await this.sendCommand("Input.dispatchKeyEvent", { type:"char", text:key })
      }
      await this.sendCommand("Input.dispatchKeyEvent", { type:"keyUp", key:k.key, code:k.code, windowsVirtualKeyCode:k.keyCode, modifiers:mods })
      return { ok: true }
    } catch (e) { return { ok:false, error:(e as Error).message } }
  }
  ```

- [ ] **Step 6: 跑通过** `node --test`(browserctl)→ 全绿;`pnpm --filter digital-employee typecheck` → 通过
- [ ] **Step 7: 提交**(只 add 这 4 个文件)
  ```bash
  git add apps/web/electron/features/browser/browser-debugger-controller.ts apps/web/electron/features/browser/browser-http-bridge.ts packages/browserctl/src/index.js packages/browserctl/test/index.test.js
  git commit -m "feat(browserctl): add press command (keyboard keys + modifiers)"
  ```

---

## Task 2: scroll + click 自动 scrollIntoView

**Files:** 同 Task 1 四个文件

- [ ] **Step 1: 写失败测试**
```javascript
test("scroll --to bottom", async () => {
  let reqUrl, body
  const srv = await startServer(async (req, res) => { reqUrl=req.url; body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true})) })
  try {
    await runCli(["scroll", "--to", "bottom"], { env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.ok(reqUrl.endsWith("/scroll")); assert.equal(body.to, "bottom")
  } finally { await closeServer(srv) }
})
test("scroll @eN 走 scrollIntoView", async () => {
  let body
  const srv = await startServer(async (req, res) => { body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true})) })
  try {
    await runCli(["scroll", "@e8"], { env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.equal(body.ref_or_selector, "@e8")
  } finally { await closeServer(srv) }
})
```

- [ ] **Step 2: 跑失败**
- [ ] **Step 3: browserctl 命令**(index.js):parseFlags 加 `--to <pos>`(取值)、`--by <n>`(Number);usage 加 scroll;run():
  ```javascript
  if (command === "scroll") {
    const refOrSelector = rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined
    print(await postAction("scroll", {
      ref_or_selector: refOrSelector,
      to: flags.to,
      by: Number.isFinite(flags.by) ? flags.by : undefined,
    }), flags.pretty)
    return
  }
  ```
- [ ] **Step 4: bridge action** `case "scroll"`:取 ref_or_selector/to/by → `dbg.scroll({refOrSelector, to, by})`
- [ ] **Step 5: debugger 方法 + click 改造**
  ```ts
  async scrollIntoView(refOrSelector: string): Promise<void> {
    const node = await this.resolveNode(refOrSelector)
    if (!node?.backendNodeId) {
      // selector:evaluate
      const escaped = refOrSelector.replace(/\\/g,"\\\\").replace(/'/g,"\\'")
      await this.sendCommand("Runtime.evaluate", { expression:`document.querySelector('${escaped}')?.scrollIntoView({block:'center',inline:'center'})` })
      return
    }
    const resolved = (await this.sendCommand("DOM.resolveNode",{backendNodeId:node.backendNodeId})) as {object?:{objectId?:string}}
    if (resolved.object?.objectId) {
      await this.sendCommand("Runtime.callFunctionOn", { objectId:resolved.object.objectId, functionDeclaration:"function(){ this.scrollIntoView({block:'center',inline:'center'}) }" })
    }
  }
  async scroll(opts: { refOrSelector?: string; to?: string; by?: number }): Promise<CdpResult> {
    try {
      if (opts.refOrSelector) { await this.scrollIntoView(opts.refOrSelector); return { ok:true } }
      if (opts.to === "bottom") await this.sendCommand("Runtime.evaluate", { expression:"window.scrollTo(0, document.body.scrollHeight)" })
      else if (opts.to === "top") await this.sendCommand("Runtime.evaluate", { expression:"window.scrollTo(0,0)" })
      else if (typeof opts.by === "number") await this.sendCommand("Runtime.evaluate", { expression:`window.scrollBy(0, ${opts.by})` })
      return { ok:true }
    } catch (e) { return { ok:false, error:(e as Error).message } }
  }
  ```
  **click 改造**:在 `click` 的 `resolveNode` 成功后、派发鼠标前,加 `await this.scrollIntoView(refOrSelector)` 然后**重新 resolveNode/getBbox 取最新坐标**(滚动后坐标变);用最新 center 点击。注意保持原有 ELEMENT_NOT_FOUND 行为。
- [ ] **Step 6: 测试 + typecheck 通过**
- [ ] **Step 7: 提交** `feat(browserctl): add scroll command + auto scrollIntoView before click (fixes off-screen click)`

---

## Task 3: select 下拉选择(含抽 runOnElement helper)

**Files:** 同上四个文件

- [ ] **Step 1: 写失败测试**
```javascript
test("select 按 label", async () => {
  let reqUrl, body
  const srv = await startServer(async (req,res)=>{ reqUrl=req.url; body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true})) })
  try {
    await runCli(["select","@e5","--label","北京"], { env:{ BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.ok(reqUrl.endsWith("/select")); assert.equal(body.ref_or_selector,"@e5"); assert.equal(body.label,"北京")
  } finally { await closeServer(srv) }
})
test("select 按 value(位置参数)", async () => {
  let body
  const srv = await startServer(async (req,res)=>{ body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true})) })
  try {
    await runCli(["select","@e5","BJ"], { env:{ BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.equal(body.value,"BJ")
  } finally { await closeServer(srv) }
})
```
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: browserctl 命令**:parseFlags 加 `--label <text>`;run():
  ```javascript
  if (command === "select") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const value = rest[1]  // 位置参数为 value
    print(await postAction("select", { ref_or_selector: refOrSelector, value, label: flags.label }), flags.pretty)
    return
  }
  ```
- [ ] **Step 4: bridge action** `case "select"` → `dbg.select(refOrSelector, {value, label})`
- [ ] **Step 5: 抽 runOnElement(见"通用基建")+ select 方法**
  ```ts
  async select(refOrSelector: string, opts: { value?: string; label?: string }): Promise<CdpResult> {
    try {
      const v = JSON.stringify(opts.value ?? null)
      const lbl = JSON.stringify(opts.label ?? null)
      const ok = await this.runOnElement(refOrSelector, `
        if (el.tagName !== 'SELECT') return false;
        const value=${v}, label=${lbl};
        let matched=false;
        for (const o of el.options) {
          if ((value!=null && o.value===value) || (label!=null && o.textContent.trim()===label)) { el.value=o.value; matched=true; break; }
        }
        if (matched) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
        return matched;
      `)
      return ok ? { ok:true } : { ok:false, error:"option not found", code:"OPTION_NOT_FOUND" }
    } catch (e) { return { ok:false, error:(e as Error).message } }
  }
  ```
- [ ] **Step 6: 测试 + typecheck**
- [ ] **Step 7: 提交** `feat(browserctl): add select command for dropdowns`

---

## Task 4: get value / attribute

**Files:** 同上四个文件 + SKILL.md/reference.md

- [ ] **Step 1: 写失败测试**
```javascript
test("get value 走 get-value action", async () => {
  let reqUrl, body
  const srv = await startServer(async (req,res)=>{ reqUrl=req.url; body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true,data:{value:"x"}})) })
  try {
    const { stdout } = await runCli(["get","value","@e4"], { env:{ BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.ok(reqUrl.endsWith("/get-value")); assert.equal(body.ref_or_selector,"@e4")
    assert.equal(JSON.parse(stdout).data.value,"x")
  } finally { await closeServer(srv) }
})
test("get attr 走 get-attribute action", async () => {
  let reqUrl, body
  const srv = await startServer(async (req,res)=>{ reqUrl=req.url; body=JSON.parse(await readBody(req)); res.end(JSON.stringify({ok:true,data:{value:"#"}})) })
  try {
    await runCli(["get","attr","@e7","href"], { env:{ BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) } })
    assert.ok(reqUrl.endsWith("/get-attribute")); assert.equal(body.ref_or_selector,"@e7"); assert.equal(body.name,"href")
  } finally { await closeServer(srv) }
})
```
- [ ] **Step 2: 跑失败**
- [ ] **Step 3: browserctl `get` 分发扩展**(index.js 现有 `command === "get"` 块,加 value/attr 分支)
  ```javascript
  if (command === "get") {
    const target = rest[0]
    if (target === "url") { print(await postAction("get-url", {}), flags.pretty); return }
    if (target === "title") { print(await postAction("get-title", {}), flags.pretty); return }
    if (target === "value") {
      const refOrSelector = rest[1]
      if (!refOrSelector) throw new Error("ref or selector required")
      print(await postAction("get-value", { ref_or_selector: refOrSelector }), flags.pretty); return
    }
    if (target === "attr" || target === "attribute") {
      const refOrSelector = rest[1], name = rest[2]
      if (!refOrSelector || !name) throw new Error("ref/selector and attribute name required")
      print(await postAction("get-attribute", { ref_or_selector: refOrSelector, name }), flags.pretty); return
    }
    throw new Error("get target must be url|title|value|attr")
  }
  ```
  usage 更新 `get url|title|value <@eN|sel>|attr <@eN|sel> <name>`
- [ ] **Step 4: bridge actions** `case "get-value"` / `case "get-attribute"` → dbg.getValue / dbg.getAttribute
- [ ] **Step 5: debugger 方法**(复用 runOnElement)
  ```ts
  async getValue(refOrSelector: string): Promise<CdpResult<{ value: string | null }>> {
    try {
      const v = await this.runOnElement(refOrSelector, "return (el.value != null ? String(el.value) : (el.getAttribute('value') ?? null));")
      return { ok:true, data:{ value: (v as string|null) ?? null } }
    } catch (e) { return { ok:false, error:(e as Error).message } }
  }
  async getAttribute(refOrSelector: string, name: string): Promise<CdpResult<{ value: string | null }>> {
    try {
      const v = await this.runOnElement(refOrSelector, `return el.getAttribute(${JSON.stringify(name)});`)
      return { ok:true, data:{ value: (v as string|null) ?? null } }
    } catch (e) { return { ok:false, error:(e as Error).message } }
  }
  ```
- [ ] **Step 6: 文档**:SKILL.md 常用命令 + reference.md 命令表/错误码(OPTION_NOT_FOUND)加这四个命令
- [ ] **Step 7: 测试 + typecheck 通过**
- [ ] **Step 8: 提交** `feat(browserctl): add get value/attr + document press/scroll/select/get`

---

## Task 5: 手动 E2E(需 GUI)
- [ ] 重启 `dev:app`;百度搜索框 `fill` 后 `press Enter` → 提交搜索
- [ ] 长页面 `click` 一个需滚动才可见的元素 → 不再落空(scrollIntoView 生效)
- [ ] 一个有原生 `<select>` 的页面 `select @eN --label "..."` → 选中且触发联动
- [ ] `fill` 后 `get value @eN` → 返回刚填的值;`get attr @eN href` → 返回链接

## 完成定义
- browserctl `node --test` 全绿(原有 + 新 press/scroll/select/get 用例)
- `pnpm --filter digital-employee typecheck` 通过
- 手动 E2E(Task 5)通过

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { BrowserController } from "../src/controller.js"
import type { Transport } from "../src/transport.js"

function mockTransport(
  responses: Record<string, unknown> = {}
): Transport & { calls: Array<[string, unknown]> } {
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
test("getUrl 走纯 CDP（不依赖 Electron webContents）", async () => {
  // 现有 CDP fallback 用 Runtime.evaluate("window.location.href")，按其返回形状 mock
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: "https://oa.example.com/" } },
  })
  const c = new BrowserController(t)
  const r = await c.getUrl()
  assert.equal(r.ok, true)
  assert.equal((r.data as { url: string }).url, "https://oa.example.com/")
  // 全是 CDP 方法（含 "."），无 Electron 原生调用
  assert.ok(t.calls.every(([m]) => m.includes(".")))
})

test("snapshot 调 Accessibility.getFullAXTree（命令逻辑复用）", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": {
      nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  const r = await c.snapshot(50)
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getFullAXTree"))
})

test("fill 用 Input.insertText 一次性输入（非逐字符 dispatchKeyEvent char）", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: { x: 10, y: 10 } } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.fill("#kw", "关键词")
  const charCalls = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchKeyEvent" && (p as { type?: string }).type === "char"
  )
  assert.equal(charCalls.length, 0, "不应再发逐字符 char 事件")
  const insertCalls = t.calls.filter(([m]) => m === "Input.insertText")
  assert.ok(insertCalls.length >= 1, "应调用 Input.insertText")
  assert.equal((insertCalls[0][1] as { text?: string }).text, "关键词")
})

test("hover 派发单次 mouseMoved 到元素中心", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 100, 0, 100] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.hover("@e0")
  const moved = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mouseMoved"
  )
  assert.equal(moved.length, 1)
  const p = moved[0][1] as { x: number; y: number }
  assert.equal(p.x, 50)
  assert.equal(p.y, 50)
})

test("dblclick 派发 clickCount:2 的 pressed+released", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.dblclick("@e0")
  const pressed = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mousePressed"
  )
  const released = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mouseReleased"
  )
  assert.equal(pressed.length, 1)
  assert.equal(released.length, 1)
  assert.equal((pressed[0][1] as { clickCount?: number }).clickCount, 2)
  assert.equal((released[0][1] as { clickCount?: number }).clickCount, 2)
})

test("focus 调 callFunctionOn this.focus()", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.focus("@e0")
  const callFn = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.callFunctionOn" &&
      String(
        (p as { functionDeclaration?: string }).functionDeclaration
      ).includes("this.focus()")
  )
  assert.ok(callFn.length >= 1)
})

test("type 不清空：printable 走 insertText，\\n 走 keyDown+keyUp", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.type("@e0", "ab\n")
  const focusCalls = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.callFunctionOn" &&
      String(
        (p as { functionDeclaration?: string }).functionDeclaration
      ).includes("this.focus()")
  )
  assert.ok(focusCalls.length >= 1)
  const insertCalls = t.calls.filter(([m]) => m === "Input.insertText")
  assert.ok(insertCalls.some(([, p]) => (p as { text?: string }).text === "a"))
  assert.ok(insertCalls.some(([, p]) => (p as { text?: string }).text === "b"))
  const keyDown = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchKeyEvent" &&
      (p as { type?: string }).type === "keyDown"
  )
  const keyUp = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchKeyEvent" &&
      (p as { type?: string }).type === "keyUp"
  )
  assert.ok(keyDown.length >= 1)
  assert.ok(keyUp.length >= 1)
  const clearCalls = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.callFunctionOn" &&
      String(
        (p as { functionDeclaration?: string }).functionDeclaration
      ).includes("setter.call(el, '')")
  )
  assert.equal(clearCalls.length, 0, "type 不应清空")
})

test("check：未勾选时点击，再回读校验", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": { result: { value: false } },
  })
  // 用 isCheckedCall 专用计数器模拟 isChecked 多次回读（前两次 false、JS-click 后第三次 true）。
  // 仅拦截 callFunctionOn；其他方法委托原 sendCommand 走 responses 映射，避免破坏 snapshot/resolveNode。
  const origSend = t.sendCommand.bind(t)
  let isCheckedCall = 0
  t.sendCommand = async (method, params) => {
    if (method === "Runtime.callFunctionOn") {
      t.calls.push([method, params])
      const fn = String(
        (params as { functionDeclaration?: string }).functionDeclaration
      )
      if (fn.includes("return !!el.checked") || fn.includes("aria-checked")) {
        isCheckedCall++
        return { result: { value: isCheckedCall <= 2 ? false : true } }
      }
      return { result: { value: undefined } }
    }
    return origSend(method, params)
  }
  const c = new BrowserController(t)
  const r = await c.check("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { checked?: boolean }).checked, true)
  assert.ok(isCheckedCall >= 3, "至少 3 次 isChecked 回读才成功")
})

test("drag：10 步插值 mouseMoved", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  // 按 backendNodeId 稳定返回 box：@e0→bnid 1→(10,10)，@e1→bnid 2→(110,110)
  // （曾按调用序号返回，但 scrollIntoView 也会触发 getBoxModel 导致序号漂移、
  // src 与 tgt 撞到同点被零距离分支跳过插值）
  const origSend = t.sendCommand.bind(t)
  t.sendCommand = async (method, params) => {
    if (method === "DOM.getBoxModel") {
      t.calls.push([method, params])
      const bnid = (params as { backendNodeId?: number }).backendNodeId ?? 0
      return {
        model: {
          content:
            bnid === 2
              ? [100, 100, 120, 100, 120, 120, 100, 120]
              : [0, 0, 20, 0, 20, 20, 0, 20],
        },
      }
    }
    return origSend(method, params)
  }
  const c = new BrowserController(t)
  const r = await c.drag("@e0", "@e1")
  assert.equal(r.ok, true)
  const moved = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mouseMoved"
  )
  // 1 次初始 moveTo source + 10 步插值 = 11 次 mouseMoved
  assert.equal(moved.length, 11)
})

test("upload：文件不存在 → FILE_NOT_FOUND", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
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
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            nodeId: "1",
            role: { value: "RootWebArea" },
            childIds: ["2"],
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            role: { value: "button" },
            name: { value: "OK" },
            backendDOMNodeId: 2,
          },
        ],
      },
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

test("type 把 \\r\\n 归一化为单次 Enter（Windows 行尾不应产生两次 Enter）", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.type("@e0", "a\r\nb")
  const enterDown = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchKeyEvent" &&
      (p as { type?: string }).type === "keyDown" &&
      (p as { key?: string }).key === "Enter"
  )
  const enterUp = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchKeyEvent" &&
      (p as { type?: string }).type === "keyUp" &&
      (p as { key?: string }).key === "Enter"
  )
  assert.equal(enterDown.length, 1, "应只产生 1 次 Enter keyDown")
  assert.equal(enterUp.length, 1, "应只产生 1 次 Enter keyUp")
  // 'a' 与 'b' 仍走 insertText
  const insertTexts = t.calls
    .filter(([m]) => m === "Input.insertText")
    .map(([, p]) => (p as { text?: string }).text)
  assert.deepEqual(insertTexts, ["a", "b"])
})

test("focus 支持 CSS 选择器（backendNodeId=0 走 Runtime.evaluate 取 objectId）", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { objectId: "obj-sel" } },
  })
  const c = new BrowserController(t)
  const r = await c.focus("input#x")
  assert.equal(r.ok, true)
  const evalCalls = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.evaluate" &&
      String((p as { expression?: string }).expression).includes(
        "document.querySelector"
      )
  )
  assert.ok(evalCalls.length >= 1, "应通过 Runtime.evaluate 取元素")
  const focusCalls = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.callFunctionOn" &&
      (p as { objectId?: string }).objectId === "obj-sel" &&
      String(
        (p as { functionDeclaration?: string }).functionDeclaration
      ).includes("this.focus()")
  )
  assert.equal(focusCalls.length, 1, "应用取到的 objectId 调 this.focus()")
})

test("type 支持 CSS 选择器（focus 后 insertText 不依赖 nodeId）", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { objectId: "obj-sel" } },
  })
  const c = new BrowserController(t)
  const r = await c.type("input#x", "hi")
  assert.equal(r.ok, true)
  const focusCalls = t.calls.filter(
    ([m, p]) =>
      m === "Runtime.callFunctionOn" &&
      (p as { objectId?: string }).objectId === "obj-sel" &&
      String(
        (p as { functionDeclaration?: string }).functionDeclaration
      ).includes("this.focus()")
  )
  assert.equal(focusCalls.length, 1)
  const insertTexts = t.calls
    .filter(([m]) => m === "Input.insertText")
    .map(([, p]) => (p as { text?: string }).text)
  assert.deepEqual(insertTexts, ["h", "i"])
})

test("upload 支持 CSS 选择器（用 objectId 调 setFileInputFiles）", async () => {
  const tmp1 = path.join(
    os.tmpdir(),
    `browserctl-upload-sel1-${Date.now()}.txt`
  )
  const tmp2 = path.join(
    os.tmpdir(),
    `browserctl-upload-sel2-${Date.now()}.txt`
  )
  fs.writeFileSync(tmp1, "a")
  fs.writeFileSync(tmp2, "b")
  try {
    const t = mockTransport({
      "Runtime.evaluate": { result: { objectId: "obj-sel" } },
    })
    const c = new BrowserController(t)
    const r = await c.upload("input#x", [tmp1, tmp2])
    assert.equal(r.ok, true)
    assert.equal((r.data as { uploaded?: number }).uploaded, 2)
    const setFile = t.calls.filter(([m]) => m === "DOM.setFileInputFiles")
    assert.equal(setFile.length, 1)
    const params = setFile[0][1] as {
      files?: string[]
      objectId?: string
      backendNodeId?: number
    }
    assert.equal(params.objectId, "obj-sel")
    assert.equal(params.backendNodeId, undefined)
    assert.equal(params.files?.length, 2)
    // 两个绝对路径
    assert.ok(params.files?.every((f) => path.isAbsolute(f)))
  } finally {
    fs.unlinkSync(tmp1)
    fs.unlinkSync(tmp2)
  }
})

test("drag 零距离：source 与 target 同点时跳过 10 步插值", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  // @e0 与 @e1 都用同一个 boxModel → 中心都是 (10,10)，零距离
  const r = await c.drag("@e0", "@e1")
  assert.equal(r.ok, true)
  const moved = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mouseMoved"
  )
  // 仅 1 次初始 mouseMoved，无 10 步插值
  assert.equal(moved.length, 1, "零距离应只有 1 次 mouseMoved（无插值步）")
  const pressed = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mousePressed"
  )
  const released = t.calls.filter(
    ([m, p]) =>
      m === "Input.dispatchMouseEvent" &&
      (p as { type?: string }).type === "mouseReleased"
  )
  assert.equal(pressed.length, 1)
  assert.equal(released.length, 1)
})

test("upload 多文件：uploaded 计数与 setFileInputFiles 收到两个绝对路径", async () => {
  const tmp1 = path.join(
    os.tmpdir(),
    `browserctl-upload-multi1-${Date.now()}.txt`
  )
  const tmp2 = path.join(
    os.tmpdir(),
    `browserctl-upload-multi2-${Date.now()}.txt`
  )
  fs.writeFileSync(tmp1, "a")
  fs.writeFileSync(tmp2, "b")
  try {
    const t = mockTransport({
      "DOM.resolveNode": { object: { objectId: "obj-1" } },
      "DOM.getBoxModel": { model: { content: [0, 0, 20, 0, 20, 20, 0, 20] } },
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            nodeId: "1",
            role: { value: "RootWebArea" },
            childIds: ["2"],
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            role: { value: "button" },
            name: { value: "OK" },
            backendDOMNodeId: 2,
          },
        ],
      },
      "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    })
    const c = new BrowserController(t)
    const r = await c.upload("@e0", [tmp1, tmp2])
    assert.equal(r.ok, true)
    assert.equal((r.data as { uploaded?: number }).uploaded, 2)
    const setFile = t.calls.filter(([m]) => m === "DOM.setFileInputFiles")
    assert.equal(setFile.length, 1)
    const params = setFile[0][1] as { files?: string[]; backendNodeId?: number }
    assert.equal(params.files?.length, 2)
    assert.ok(params.files?.every((f) => path.isAbsolute(f)))
    // @e0 → RootWebArea，backendDOMNodeId=1
    assert.equal(params.backendNodeId, 1)
  } finally {
    fs.unlinkSync(tmp1)
    fs.unlinkSync(tmp2)
  }
})

// ---- Batch 2: 事件多路复用 + wait 增强 ----

function eventTransport(
  sendCommand: (method: string, params: Record<string, unknown>) => Promise<unknown>
): Transport & {
  emit: (m: string, p: unknown) => void
  calls: Array<[string, unknown]>
} {
  let onCb: ((m: string, p: unknown, sessionId?: string) => void) | null = null
  const calls: Array<[string, unknown]> = []
  const t: Transport & {
    calls: Array<[string, unknown]>
    emit: (m: string, p: unknown) => void
  } = {
    calls,
    attach: async () => {},
    detach: async () => {},
    isAttached: () => true,
    on: (_ev, cb) => {
      onCb = cb
    },
    sendCommand: async (method, params) => {
      calls.push([method, params])
      return sendCommand(method, params as Record<string, unknown>)
    },
    emit: (m, p) => {
      onCb?.(m, p)
    },
  }
  return t
}

test("事件多路复用：addMessageListener pred 命中后 cb 调用，disposer 移除后不再触发", async () => {
  const t = eventTransport(async () => ({}))
  const c = new BrowserController(t)
  let hit = 0
  const dispose = c.addMessageListener(
    (m) => m === "Page.lifecycleEvent",
    () => {
      hit++
    }
  )
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(hit, 1)
  dispose()
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(hit, 1, "disposer 后不再触发")
})

test("waitForNetworkIdle：已 idle 短路（不依赖事件直接成功）", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      return { result: { value: true } }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForNetworkIdle(5000)
  assert.equal(r.ok, true)
})

test("waitForNetworkIdle：未 idle 时等 networkIdle 事件后成功", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      return { result: { value: false } }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = c.waitForNetworkIdle(5000)
  await new Promise((res) => setTimeout(res, 50))
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  const result = await r
  assert.equal(result.ok, true)
})

test("waitForNetworkIdle：resolve 后内部 listener 自移除，外部 listener 不受影响", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      return { result: { value: false } }
    }
    return {}
  })
  const c = new BrowserController(t)
  let outerHits = 0
  const outerDispose = c.addMessageListener(
    (m, p) =>
      m === "Page.lifecycleEvent" &&
      (p as { name?: string }).name === "networkIdle",
    () => {
      outerHits++
    }
  )
  const r = c.waitForNetworkIdle(5000)
  await new Promise((res) => setTimeout(res, 30))
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  await r
  // waitForNetworkIdle 内部 listener 应已自移除；再 emit 一次，外部 listener 仍响应
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(outerHits, 2, "外部 listener 应两次响应")
  outerDispose()
  t.emit("Page.lifecycleEvent", { name: "networkIdle" })
  assert.equal(outerHits, 2, "外部 disposer 后不再响应")
})

test("waitForNetworkIdle：超时返回 TIMEOUT", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      return { result: { value: false } }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForNetworkIdle(100)
  assert.equal(r.ok, false)
  assert.equal(r.code, "TIMEOUT")
})

test("waitForUrl：glob 匹配成功", async () => {
  let evalCount = 0
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      evalCount++
      return {
        result: {
          value:
            evalCount === 1
              ? "https://example.com/login"
              : "https://example.com/dashboard",
        },
      }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForUrl("https://example.com/dashboard", 5000)
  assert.equal(r.ok, true)
})

test("waitForFunction：return true 即满足", async () => {
  let evalCount = 0
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? false : true } }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForFunction(
    "document.querySelector('.ready') !== null",
    5000
  )
  assert.equal(r.ok, true)
})

test("waitForState hidden：元素 display:none 即满足", async () => {
  let evalCount = 0
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") {
      evalCount++
      return { result: { value: evalCount === 1 ? false : true } }
    }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForState("#modal", "hidden", 5000)
  assert.equal(r.ok, true)
})

test("snapshot scope 用 Accessibility.getChildAXTree", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": {
      nodes: [{ nodeId: "1", role: { value: "RootWebArea" }, childIds: [] }],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "DOM.querySelector": { nodeId: 100 },
    "Accessibility.getChildAXTree": {
      nodes: [
        { nodeId: "10", role: { value: "button" }, name: { value: "OK" } },
      ],
    },
  })
  const c = new BrowserController(t)
  const r = await c.snapshot(200, { scopeSelector: "#modal" })
  assert.equal(r.ok, true)
  assert.ok(t.calls.some(([m]) => m === "Accessibility.getChildAXTree"))
})

test("snapshot scope 回退：getChildAXTree 抛错 → describeNode + 子树过滤", async () => {
  const fullTree = [
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      childIds: ["2", "5"],
      backendDOMNodeId: 1,
    },
    {
      nodeId: "2",
      role: { value: "generic" },
      childIds: ["3"],
      backendDOMNodeId: 100,
    },
    {
      nodeId: "3",
      role: { value: "button" },
      name: { value: "InModal" },
      backendDOMNodeId: 101,
    },
    {
      nodeId: "5",
      role: { value: "button" },
      name: { value: "Outside" },
      backendDOMNodeId: 200,
    },
  ]
  const t = mockTransport({
    "DOM.querySelector": { nodeId: 100 },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Accessibility.getChildAXTree") {
      throw new Error("not supported")
    }
    if (method === "DOM.describeNode") {
      return { node: { backendNodeId: 100 } }
    }
    if (method === "Accessibility.getFullAXTree") {
      return { nodes: fullTree }
    }
    if (method === "DOM.querySelector") return { nodeId: 100 }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.snapshot(200, { scopeSelector: "#modal" })
  assert.equal(r.ok, true)
  const names = (r.data?.refs ?? []).map((ref) => ref.name)
  assert.ok(names.includes("InModal"))
  assert.ok(!names.includes("Outside"), "回退路径应裁剪 scope 外节点")
  assert.ok(t.calls.some(([m]) => m === "DOM.describeNode"))
})

test("snapshot scope 仍收集 iframe 子 frame AX 树", async () => {
  const t = mockTransport({
    "DOM.querySelector": { nodeId: 100 },
    "Accessibility.getChildAXTree": {
      nodes: [{ nodeId: "10", role: { value: "button" }, name: { value: "OK" } }],
    },
    "Page.getFrameTree": {
      frameTree: {
        frame: { id: "main" },
        childFrames: [{ frame: { id: "iframe-1" } }],
      },
    },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "textbox" },
          name: { value: "iframe输入" },
          backendDOMNodeId: 20,
        },
      ],
    },
  })
  const c = new BrowserController(t)
  const r = await c.snapshot(200, { scopeSelector: "#modal" })
  assert.equal(r.ok, true)
  assert.ok(
    t.calls.some(
      ([m, p]) =>
        m === "Accessibility.getFullAXTree" &&
        (p as { frameId?: string }).frameId === "iframe-1"
    ),
    "scope 路径仍应收集 iframe 子 frame"
  )
  assert.ok(
    (r.data?.refs ?? []).some((ref) => ref.name === "iframe输入"),
    "iframe 内节点应出现在 refs"
  )
})

test("screenshot --annotate：注入 overlay、captureBeyondViewport:true、移除 overlay", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } },
    "Accessibility.getFullAXTree": {
      nodes: [
        { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 1,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": {
      result: { value: { x: 0, y: 0, width: 100, height: 50 } },
    },
    "Runtime.evaluate": { result: { value: true } },
    "Page.captureScreenshot": { data: "iVBOR" },
  })
  const c = new BrowserController(t)
  await c.snapshot(200)
  const r = await c.screenshot({ annotate: true })
  assert.equal(r.ok, true)
  assert.ok((r.data as { annotations?: unknown[] }).annotations?.length)
  const shot = t.calls.filter(([m]) => m === "Page.captureScreenshot")
  assert.equal(shot.length, 1)
  assert.equal(
    (shot[0][1] as { captureBeyondViewport?: boolean }).captureBeyondViewport,
    true
  )
  const evals = t.calls.filter(([m]) => m === "Runtime.evaluate")
  assert.ok(
    evals.some(([, p]) =>
      String((p as { expression?: string }).expression).includes(
        "__browserctl_annotations__"
      )
    )
  )
  assert.ok(
    evals.some(([, p]) =>
      String((p as { expression?: string }).expression).includes("remove()")
    )
  )
})

test("screenshot --annotate：captureScreenshot 失败仍移除 overlay", async () => {
  const t = mockTransport({
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "Accessibility.getFullAXTree": {
      nodes: [
        { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 1,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": {
      result: { value: { x: 0, y: 0, width: 100, height: 50 } },
    },
    "Runtime.evaluate": { result: { value: true } },
  })
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          { nodeId: "1", role: { value: "RootWebArea" }, childIds: ["2"] },
          {
            nodeId: "2",
            role: { value: "button" },
            name: { value: "OK" },
            backendDOMNodeId: 1,
          },
        ],
      }
    }
    if (method === "DOM.resolveNode") return { object: { objectId: "obj-1" } }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { x: 0, y: 0, width: 100, height: 50 } } }
    }
    if (method === "Runtime.evaluate") return { result: { value: true } }
    if (method === "Page.captureScreenshot") {
      throw new Error("capture failed")
    }
    return {}
  }
  const c = new BrowserController(t)
  await c.snapshot(200)
  const r = await c.screenshot({ annotate: true })
  assert.equal(r.ok, false)
  const evals = t.calls.filter(([m]) => m === "Runtime.evaluate")
  assert.ok(
    evals.some(([, p]) =>
      String((p as { expression?: string }).expression).includes(
        "__browserctl_annotations__"
      )
    ),
    "应先注入 overlay"
  )
  assert.ok(
    evals.some(([, p]) =>
      String((p as { expression?: string }).expression).includes("remove()")
    ),
    "capture 失败时 finally 仍应移除 overlay"
  )
})

test("screenshot --annotate：OOPIF ref 抛错时静默跳过", async () => {
  const t = mockTransport({
    "DOM.getBoxModel": { model: { content: [0, 0, 100, 0, 100, 50, 0, 50] } },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
    "Runtime.callFunctionOn": {
      result: { value: { x: 0, y: 0, width: 100, height: 50 } },
    },
    "Runtime.evaluate": { result: { value: true } },
    "Page.captureScreenshot": { data: "iVBOR" },
  })
  let resolveCount = 0
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Accessibility.getFullAXTree") {
      return {
        nodes: [
          {
            nodeId: "1",
            role: { value: "RootWebArea" },
            childIds: ["2"],
            backendDOMNodeId: 1,
          },
          {
            nodeId: "2",
            role: { value: "button" },
            name: { value: "OK" },
            backendDOMNodeId: 2,
          },
        ],
      }
    }
    if (method === "DOM.resolveNode") {
      resolveCount++
      if (resolveCount === 2) {
        throw new Error("Cannot find object for given backendNodeId")
      }
      return { object: { objectId: "obj-1" } }
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { x: 0, y: 0, width: 100, height: 50 } } }
    }
    if (method === "Runtime.evaluate") return { result: { value: true } }
    if (method === "Page.captureScreenshot") return { data: "iVBOR" }
    return {}
  }
  const c = new BrowserController(t)
  await c.snapshot(200)
  const r = await c.screenshot({ annotate: true })
  assert.equal(r.ok, true, "OOPIF 抛错不应中断整个 annotate")
  const anns =
    (r.data as { annotations?: Array<{ ref: string }> }).annotations ?? []
  assert.ok(anns.some((a) => a.ref === "@e0"), "@e0 仍被标注")
  assert.ok(!anns.some((a) => a.ref === "@e1"), "@e1(OOPIF) 应被跳过")
  const evals = t.calls.filter(([m]) => m === "Runtime.evaluate")
  assert.ok(
    evals.some(([, p]) =>
      String((p as { expression?: string }).expression).includes(
        "__browserctl_annotations__"
      )
    )
  )
})

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

test("evaluateJs 异常返回 EVAL_ERROR", async () => {
  const t = mockTransport({
    "Runtime.evaluate": {
      exceptionDetails: {
        text: "Uncaught ReferenceError: x is not defined",
      },
    },
  })
  const c = new BrowserController(t)
  const r = await c.evaluateJs("x", 5000)
  assert.equal(r.ok, false)
  assert.equal(r.code, "EVAL_ERROR")
})

test("evaluateJs 超时返回 TIMEOUT", async () => {
  const t = mockTransport({})
  t.sendCommand = async (method) => {
    if (method === "Runtime.evaluate") {
      await new Promise((r) => setTimeout(r, 200))
      return { result: { value: 1 } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.evaluateJs("slow()", 50)
  assert.equal(r.ok, false)
  assert.equal(r.code, "TIMEOUT")
})

test("waitForLoadEvent(load)：已 complete 短路", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") return { result: { value: true } }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForLoadEvent("load", 5000)
  assert.equal(r.ok, true)
})

test("waitForLoadEvent(load)：等 load 事件后成功", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") return { result: { value: false } }
    return {}
  })
  const c = new BrowserController(t)
  const p = c.waitForLoadEvent("load", 5000)
  await new Promise((res) => setTimeout(res, 20))
  t.emit("Page.lifecycleEvent", { name: "load" })
  assert.equal((await p).ok, true)
})

test("waitForLoadEvent(DOMContentLoaded)：探针短路", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Runtime.evaluate") return { result: { value: true } }
    return {}
  })
  const c = new BrowserController(t)
  const r = await c.waitForLoadEvent("DOMContentLoaded", 5000)
  assert.equal(r.ok, true)
})

function refElementTransport(
  callFunctionValue: unknown
): Transport & { calls: Array<[string, unknown]> } {
  return mockTransport({
    "Runtime.evaluate": { result: { value: { x: 10, y: 10 } } },
    "DOM.resolveNode": { object: { objectId: "obj-1" } },
    "DOM.getBoxModel": {
      model: { content: [0, 0, 20, 0, 20, 20, 0, 20] },
    },
    "Runtime.callFunctionOn": { result: { value: callFunctionValue } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: ["2"],
          backendDOMNodeId: 1,
        },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "OK" },
          backendDOMNodeId: 2,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
}

test("getText 返回 innerText", async () => {
  const c = new BrowserController(refElementTransport("按钮文字"))
  const r = await c.getText("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { text: string }).text, "按钮文字")
})

test("getText 元素不存在 → ELEMENT_NOT_FOUND", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: [],
          backendDOMNodeId: 1,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.snapshot(50)
  const r = await c.getText("@e99")
  assert.equal(r.ok, false)
  assert.equal(r.code, "ELEMENT_NOT_FOUND")
})

test("getHtml 返回 innerHTML", async () => {
  const c = new BrowserController(refElementTransport("<span>x</span>"))
  const r = await c.getHtml("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { html: string }).html, "<span>x</span>")
})

test("getBox 返回 bounding rect", async () => {
  const c = new BrowserController(
    refElementTransport({ x: 1, y: 2, width: 3, height: 4 })
  )
  const r = await c.getBox("@e0")
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, { x: 1, y: 2, width: 3, height: 4 })
})

test("getStyles 返回 styles 对象", async () => {
  const c = new BrowserController(
    refElementTransport({ color: "rgb(0, 0, 0)", display: "block" })
  )
  const r = await c.getStyles("@e0")
  assert.equal(r.ok, true)
  assert.deepEqual((r.data as { styles: Record<string, string> }).styles, {
    color: "rgb(0, 0, 0)",
    display: "block",
  })
})

test("getCount @eN 存在 → 1", async () => {
  const c = new BrowserController(refElementTransport("x"))
  await c.snapshot(50)
  const r = await c.getCount("@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { count: number }).count, 1)
})

test("getCount CSS 选择器 → querySelectorAll 长度", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: 3 } },
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: [],
          backendDOMNodeId: 1,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  const r = await c.getCount(".item")
  assert.equal(r.ok, true)
  assert.equal((r.data as { count: number }).count, 3)
  const evalCall = t.calls.find(([m]) => m === "Runtime.evaluate")
  assert.ok(String((evalCall?.[1] as { expression?: string }).expression).includes(".item"))
})

test("queryIs visible：存在且可见 → result true", async () => {
  const c = new BrowserController(refElementTransport(true))
  const r = await c.queryIs("visible", "@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { result: boolean }).result, true)
})

test("queryIs visible：存在但 hidden → result false", async () => {
  const c = new BrowserController(refElementTransport(false))
  const r = await c.queryIs("visible", "@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { result: boolean }).result, false)
})

test("queryIs enabled：result false", async () => {
  const c = new BrowserController(refElementTransport(false))
  const r = await c.queryIs("enabled", "@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { result: boolean }).result, false)
})

test("queryIs checked：不可勾选 → NOT_CHECKABLE", async () => {
  const c = new BrowserController(refElementTransport(null))
  const r = await c.queryIs("checked", "@e0")
  assert.equal(r.ok, false)
  assert.equal(r.code, "NOT_CHECKABLE")
})

test("queryIs checked：已勾选 → result true", async () => {
  const c = new BrowserController(refElementTransport(true))
  const r = await c.queryIs("checked", "@e0")
  assert.equal(r.ok, true)
  assert.equal((r.data as { result: boolean }).result, true)
})

test("clickAt 派发 pressed+released", async () => {
  const t = mockTransport({})
  const c = new BrowserController(t)
  await c.clickAt(50, 60)
  const types = t.calls
    .filter(([m]) => m === "Input.dispatchMouseEvent")
    .map(([, p]) => (p as { type: string }).type)
  assert.deepEqual(types, ["mousePressed", "mouseReleased"])
})

test("scrollIntoView 选择器找不到 → ELEMENT_NOT_FOUND", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: { value: null } },
  })
  const c = new BrowserController(t)
  const r = await c.scrollIntoView("#missing")
  assert.equal(r.ok, false)
  assert.equal(r.code, "ELEMENT_NOT_FOUND")
})

test("scrollIntoView @eN 不存在 → ELEMENT_NOT_FOUND", async () => {
  const t = mockTransport({
    "Accessibility.getFullAXTree": {
      nodes: [
        {
          nodeId: "1",
          role: { value: "RootWebArea" },
          childIds: [],
          backendDOMNodeId: 1,
        },
      ],
    },
    "Page.getFrameTree": { frameTree: { frame: { id: "main" } } },
  })
  const c = new BrowserController(t)
  await c.snapshot(50)
  const r = await c.scrollIntoView("@e99")
  assert.equal(r.ok, false)
  assert.equal(r.code, "ELEMENT_NOT_FOUND")
})

test("fillOnObjectId focus + clear + insertText", async () => {
  const t = mockTransport({
    "Runtime.callFunctionOn": { result: { value: undefined } },
  })
  const c = new BrowserController(t)
  const r = await c.fillOnObjectId("obj-1", "hello")
  assert.equal(r.ok, true)
  const insert = t.calls.filter(([m]) => m === "Input.insertText")
  assert.equal(insert.length, 1)
  assert.equal((insert[0][1] as { text?: string }).text, "hello")
})

test("checkOnObjectId 已勾选短路", async () => {
  let callN = 0
  const t = mockTransport({})
  t.sendCommand = async (method) => {
    if (method === "Runtime.callFunctionOn") {
      callN++
      return { result: { value: true } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.checkOnObjectId("obj-1")
  assert.equal(r.ok, true)
  assert.equal((r.data as { checked: boolean }).checked, true)
  assert.equal(callN, 1, "已勾选时不应 clickAt")
})

test("findAndAct first + click 走 objectId 路径", async () => {
  let evalN = 0
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    t.calls.push([method, params])
    if (method === "Runtime.evaluate") {
      evalN++
      return { result: { objectId: "obj-find" } }
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { x: 50, y: 60 } } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.findAndAct("first", "#btn", "click")
  assert.equal(r.ok, true)
  assert.equal(evalN, 1)
  const types = t.calls
    .filter(([m]) => m === "Input.dispatchMouseEvent")
    .map(([, p]) => (p as { type: string }).type)
  assert.ok(types.includes("mousePressed"))
})

test("findAndAct nth 2 使用 1-based 索引", async () => {
  let expr = ""
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    if (method === "Runtime.evaluate") {
      expr = (params as { expression: string }).expression
      return { result: { objectId: "obj-nth" } }
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { x: 10, y: 10 } } }
    }
    return {}
  }
  const c = new BrowserController(t)
  await c.findAndAct("nth", ".item", "click", undefined, { nth: 2 })
  assert.match(expr, /\[1\]/)
})

test("findAndAct role --name 定位表达式含 role 与 name", async () => {
  let expr = ""
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    if (method === "Runtime.evaluate") {
      expr = (params as { expression: string }).expression
      return { result: { objectId: "obj-role" } }
    }
    if (method === "Runtime.callFunctionOn") {
      return { result: { value: { x: 10, y: 10 } } }
    }
    return {}
  }
  const c = new BrowserController(t)
  await c.findAndAct("role", "button", "click", undefined, {
    name: "提交",
  })
  assert.match(expr, /button/)
  assert.match(expr, /提交/)
})

test("findAndAct text --exact 定位表达式含 exact", async () => {
  let expr = ""
  const t = mockTransport({})
  t.sendCommand = async (method, params) => {
    if (method === "Runtime.evaluate") {
      expr = (params as { expression: string }).expression
      return { result: { objectId: "obj-text" } }
    }
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.findAndAct("text", "登录", "text", undefined, {
    exact: true,
  })
  assert.equal(r.ok, true)
  assert.match(expr, /exact/)
})

test("findAndAct 未匹配 → ELEMENT_NOT_FOUND", async () => {
  const t = mockTransport({
    "Runtime.evaluate": { result: {} },
  })
  const c = new BrowserController(t)
  const r = await c.findAndAct("first", "#missing", "click")
  assert.equal(r.ok, false)
  assert.equal(r.code, "ELEMENT_NOT_FOUND")
})

test("back 调 Page.goBack 并返回 getUrl/getTitle", async () => {
  let evalN = 0
  const t = mockTransport({
    "Page.goBack": {},
  })
  t.sendCommand = async (method) => {
    t.calls.push([method, {}])
    if (method === "Page.goBack") return {}
    if (method === "Runtime.evaluate") {
      evalN++
      if (evalN === 1) return { result: { value: "complete" } }
      if (evalN === 2) return { result: { value: "https://prev.example/" } }
      return { result: { value: "Prev Title" } }
    }
    if (method === "Page.enable") return {}
    return {}
  }
  const c = new BrowserController(t)
  const r = await c.back()
  assert.equal(r.ok, true)
  assert.equal((r.data as { url: string }).url, "https://prev.example/")
  assert.ok(t.calls.some(([m]) => m === "Page.goBack"))
})

test("alert 弹窗自动 accept 且 pending 为 null", async () => {
  const t = eventTransport(async (method) => {
    if (method === "Page.handleJavaScriptDialog") return {}
    return {}
  })
  const c = new BrowserController(t)
  t.emit("Page.javascriptDialogOpening", {
    type: "alert",
    message: "hello",
  })
  await new Promise((r) => setTimeout(r, 0))
  assert.ok(
    t.calls.some(([m]) => m === "Page.handleJavaScriptDialog"),
    "alert 应自动 handleJavaScriptDialog"
  )
  const status = c.getDialogStatus()
  assert.equal((status.data as { pending: boolean }).pending, false)
})

test("confirm 弹窗置 pending", async () => {
  const t = eventTransport(async () => ({}))
  const c = new BrowserController(t)
  t.emit("Page.javascriptDialogOpening", {
    type: "confirm",
    message: "sure?",
  })
  await new Promise((r) => setTimeout(r, 0))
  const status = c.getDialogStatus()
  assert.equal((status.data as { pending: boolean }).pending, true)
  assert.equal((status.data as { message: string }).message, "sure?")
})

test("dialogAccept 无 pending → DIALOG_NOT_PENDING", async () => {
  const c = new BrowserController(mockTransport({}))
  const r = await c.dialogAccept()
  assert.equal(r.ok, false)
  assert.equal(r.code, "DIALOG_NOT_PENDING")
})

import fs from "node:fs"
import path from "node:path"

import { buildRefs } from "./ax-tree.js"
import type { AxNode, RefNode } from "./ax-tree.js"
import { collectChildFrames } from "./frame-tree.js"
import type { FrameTreeNode } from "./frame-tree.js"
import type { Transport } from "./transport.js"

export interface CdpResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

// no-op logger so diagnostic call sites compile without a logger dependency
const logger = {
  info: (..._a: unknown[]) => {},
  debug: (..._a: unknown[]) => {},
  warn: (..._a: unknown[]) => {},
}

const KEY_MAP: Record<string, { key: string; code: string; keyCode: number }> =
  {
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

function resolveKey(key: string): {
  key: string
  code: string
  keyCode: number
} {
  if (KEY_MAP[key]) return KEY_MAP[key]
  if (key.length === 1) {
    const code = /[a-z]/i.test(key)
      ? `Key${key.toUpperCase()}`
      : /[0-9]/.test(key)
        ? `Digit${key}`
        : ""
    return { key, code, keyCode: key.toUpperCase().charCodeAt(0) }
  }
  return { key, code: "", keyCode: 0 }
}

// CDP Input.dispatchKeyEvent modifiers 位掩码：Alt=1, Ctrl=2, Meta=4, Shift=8
function modBits(m: Record<string, boolean>): number {
  return (
    (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0)
  )
}

export class BrowserController {
  private refCache: RefNode[] = []
  private messageListeners: Array<{
    pred: (m: string, p: unknown, sessionId?: string) => boolean
    cb: () => void
  }> = []

  // 纯命令逻辑：只依赖 transport(CDP 收发)。宿主集成(confirm/ensureBrowser/
  // afterClick/close/会话/产物路径)由 createBridge 持有的 Host 负责，不进 controller。
  constructor(private transport: Transport) {
    // 事件多路复用：单条 transport.on("message") 总分发，多个 listener 各自 pred 过滤。
    // 避免每处等待逻辑各自注册 transport.on（Electron webContents.debugger 仅一个 listener 槽）。
    transport.on("message", (method, params, sessionId) => {
      for (const l of this.messageListeners) {
        if (l.pred(method, params, sessionId)) l.cb()
      }
    })
  }

  /**
   * 注册一条 CDP 事件监听；pred 命中时调 cb。返回 disposer，调用即移除该 listener。
   * 为可观测性暴露为 public（waitForNetworkIdle 等内部等待逻辑也复用它）。
   */
  public addMessageListener(
    pred: (m: string, p: unknown, sessionId?: string) => boolean,
    cb: () => void
  ): () => void {
    const entry = { pred, cb }
    this.messageListeners.push(entry)
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== entry)
    }
  }

  private async sendCommand(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.transport.sendCommand(method, params)
  }

  async navigate(
    url: string
  ): Promise<CdpResult<{ url: string; title: string }>> {
    try {
      await this.sendCommand("Page.enable")
      await this.sendCommand("Page.navigate", { url })
      await this.waitForLoadComplete(30_000)
      const title = await this.getTitle()
      return { ok: true, data: { url, title } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async snapshot(
    maxNodes = 200,
    opts: {
      compact?: boolean
      maxDepth?: number
      scopeSelector?: string
    } = {}
  ): Promise<CdpResult<{ refs: RefNode[] }>> {
    try {
      await this.sendCommand("Accessibility.enable")
      let framesNodes: unknown[][] = []

      if (opts.scopeSelector) {
        const q = (await this.sendCommand("DOM.querySelector", {
          selector: opts.scopeSelector,
        })) as { nodeId?: number }
        if (q.nodeId) {
          try {
            const r = (await this.sendCommand("Accessibility.getChildAXTree", {
              nodeId: q.nodeId,
            })) as { nodes?: unknown[] }
            framesNodes.push(r.nodes ?? [])
          } catch {
            const r = (await this.sendCommand("Accessibility.getFullAXTree")) as {
              nodes?: unknown[]
            }
            framesNodes.push(r.nodes ?? [])
          }
        } else {
          const r = (await this.sendCommand("Accessibility.getFullAXTree")) as {
            nodes?: unknown[]
          }
          framesNodes.push(r.nodes ?? [])
        }
      } else {
        framesNodes = await this.collectFullSnapshotFrames()
      }

      const refs = buildRefs(framesNodes, maxNodes, opts)
      this.refCache = refs
      logger.info("[browser-debugger] snapshot", {
        frames: framesNodes.length,
        refs: refs.length,
        truncated: refs.length >= maxNodes,
        compact: Boolean(opts.compact),
        maxDepth: opts.maxDepth,
        scopeSelector: opts.scopeSelector,
      })
      return { ok: true, data: { refs } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** 主 frame 惰性轮询 + 子 frame 收集（跨源 OOPIF 静默跳过）。 */
  private async collectFullSnapshotFrames(): Promise<unknown[][]> {
    let mainNodes: unknown[] = []
    let rootChildCount = 0
    const deadline = Date.now() + 3000
    for (;;) {
      const result = (await this.sendCommand(
        "Accessibility.getFullAXTree"
      )) as { nodes?: unknown[] }
      mainNodes = result.nodes ?? []
      const root = mainNodes.find(
        (n) => (n as AxNode).role?.value === "RootWebArea"
      ) as AxNode | undefined
      rootChildCount = root?.childIds?.length ?? 0
      if (rootChildCount > 0 || Date.now() >= deadline) break
      await new Promise((r) => setTimeout(r, 150))
    }

    const framesNodes: unknown[][] = [mainNodes]
    let skippedFrames = 0
    try {
      const tree = (await this.sendCommand("Page.getFrameTree")) as {
        frameTree?: FrameTreeNode
      }
      const childFrameIds = tree.frameTree
        ? collectChildFrames(tree.frameTree)
        : []
      for (const frameId of childFrameIds) {
        try {
          const r = (await this.sendCommand("Accessibility.getFullAXTree", {
            frameId,
          })) as { nodes?: unknown[] }
          framesNodes.push(r.nodes ?? [])
        } catch (err) {
          skippedFrames++
          logger.debug("[browser-debugger] snapshot frame skipped", {
            frameId,
            err: (err as Error).message,
          })
        }
      }
    } catch (e) {
      logger.warn("[browser-debugger] getFrameTree failed, main-frame only", {
        err: (e as Error).message,
      })
    }

    logger.debug("[browser-debugger] collectFullSnapshotFrames", {
      frames: framesNodes.length,
      skippedFrames,
      mainRawNodes: mainNodes.length,
      rootChildCount,
    })
    return framesNodes
  }

  // 把目标滚进视口中心。@eN 走 DOM.resolveNode → callFunctionOn；
  // selector 走 Runtime.evaluate。失败静默（调用方据 resolveNode 已有兜底）。
  async scrollIntoView(refOrSelector: string): Promise<void> {
    const node = await this.resolveNode(refOrSelector)
    if (!node?.backendNodeId) {
      const escaped = refOrSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
      await this.sendCommand("Runtime.evaluate", {
        expression: `document.querySelector('${escaped}')?.scrollIntoView({block:'center',inline:'center'})`,
      })
      return
    }
    const resolved = (await this.sendCommand("DOM.resolveNode", {
      backendNodeId: node.backendNodeId,
    })) as { object?: { objectId?: string } }
    if (resolved.object?.objectId) {
      await this.sendCommand("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration:
          "function(){ this.scrollIntoView({block:'center',inline:'center'}) }",
      })
    }
  }

  // 滚动：传 ref/selector 则把该元素滚进视口；否则按 to(top/bottom)/by(px) 滚窗口。
  async scroll(opts: {
    refOrSelector?: string
    to?: string
    by?: number
  }): Promise<CdpResult> {
    try {
      if (opts.refOrSelector) {
        await this.scrollIntoView(opts.refOrSelector)
        return { ok: true }
      }
      if (opts.to === "bottom") {
        await this.sendCommand("Runtime.evaluate", {
          expression: "window.scrollTo(0, document.body.scrollHeight)",
        })
      } else if (opts.to === "top") {
        await this.sendCommand("Runtime.evaluate", {
          expression: "window.scrollTo(0,0)",
        })
      } else if (typeof opts.by === "number") {
        await this.sendCommand("Runtime.evaluate", {
          expression: `window.scrollBy(0, ${opts.by})`,
        })
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async click(refOrSelector: string): Promise<CdpResult> {
    try {
      const nodeInfo = await this.resolveNode(refOrSelector)
      if (!nodeInfo) return { ok: false, error: "ELEMENT_NOT_FOUND" }

      // 先把元素滚进视口，再重新取一次坐标：滚动会改变 getBoundingClientRect，
      // 若沿用滚动前的 center，点击会落到视口外的旧位置（off-screen click 失效）。
      // 重取若为 null（极端时序）则回退到滚动前坐标，绝不因此把已找到的元素判失败。
      await this.scrollIntoView(refOrSelector)
      const fresh = await this.resolveNode(refOrSelector)
      const { x, y } = (fresh ?? nodeInfo).center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      })
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async hover(refOrSelector: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(refOrSelector)
      const fresh = await this.resolveNode(refOrSelector)
      if (!fresh)
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      const { x, y } = fresh.center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  async dblclick(refOrSelector: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(refOrSelector)
      const fresh = await this.resolveNode(refOrSelector)
      if (!fresh)
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
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
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  async focus(refOrSelector: string): Promise<CdpResult> {
    try {
      return await this.focusByRefOrSelector(refOrSelector)
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  /**
   * 聚焦元素，供 focus / type 复用。
   * @eN 走 DOM.resolveNode → callFunctionOn；CSS 选择器走 Runtime.evaluate 取 objectId
   * 再 callFunctionOn（resolveNode 对选择器返回 backendNodeId=0，旧实现会静默 ELEMENT_NOT_FOUND）。
   * 选择器路径不调 resolveNode，避免与坐标查询的 Runtime.evaluate(returnByValue) 冲突。
   */
  private async focusByRefOrSelector(
    refOrSelector: string
  ): Promise<{ ok: true } | { ok: false; error: string; code: string }> {
    if (refOrSelector.startsWith("@e")) {
      const node = await this.resolveNode(refOrSelector)
      if (!node?.backendNodeId) {
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      }
      const resolved = (await this.sendCommand("DOM.resolveNode", {
        backendNodeId: node.backendNodeId,
      })) as { object?: { objectId?: string } }
      if (!resolved.object?.objectId) {
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      }
      await this.sendCommand("Runtime.callFunctionOn", {
        objectId: resolved.object.objectId,
        functionDeclaration: "function(){ this.focus(); }",
      })
      return { ok: true }
    }
    // 选择器路径：直接 Runtime.evaluate 取元素 objectId
    const escaped = refOrSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
    const evalResult = (await this.sendCommand("Runtime.evaluate", {
      expression: `document.querySelector('${escaped}')`,
    })) as { result?: { objectId?: string } }
    const objectId = evalResult.result?.objectId
    if (!objectId)
      return {
        ok: false,
        error: "ELEMENT_NOT_FOUND",
        code: "ELEMENT_NOT_FOUND",
      }
    await this.sendCommand("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration: "function(){ this.focus(); }",
    })
    return { ok: true }
  }

  async type(refOrSelector: string, raw: string): Promise<CdpResult> {
    try {
      const focusRes = await this.focusByRefOrSelector(refOrSelector)
      if (!focusRes.ok) return focusRes
      // 归一化 Windows \r\n → 单个 \n，避免 \r 与 \n 各触发一次 Enter
      const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
      for (const ch of text) {
        if (ch === "\n") {
          const k = resolveKey("Enter")
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: k.key,
            code: k.code,
            windowsVirtualKeyCode: k.keyCode,
          })
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: k.key,
            code: k.code,
            windowsVirtualKeyCode: k.keyCode,
          })
        } else if (ch === "\t") {
          const k = resolveKey("Tab")
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            key: k.key,
            code: k.code,
            windowsVirtualKeyCode: k.keyCode,
          })
          await this.sendCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            key: k.key,
            code: k.code,
            windowsVirtualKeyCode: k.keyCode,
          })
        } else {
          await this.sendCommand("Input.insertText", { text: ch })
        }
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  // 四级回退读 checked 状态（对齐 agent-browser element::is_element_checked）。
  // level-4（嵌套 input）为 best-effort：取 querySelector 第一个匹配，可能命中无关后代 checkbox。
  // 注意：runOnElement 已把 funcBody 包成 `function(){ const el=this; <body> }`，
  // 这里 body 不得再声明 el（否则重复声明 SyntaxError）。
  private async isChecked(refOrSelector: string): Promise<boolean | null> {
    const v = await this.runOnElement(
      refOrSelector,
      `
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

  async uncheck(
    refOrSelector: string
  ): Promise<CdpResult<{ checked: boolean }>> {
    return this.setChecked(refOrSelector, false)
  }

  private async setChecked(
    refOrSelector: string,
    expect: boolean
  ): Promise<CdpResult<{ checked: boolean }>> {
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
      if (msg === "ELEMENT_NOT_FOUND")
        return { ok: false, error: msg, code: "ELEMENT_NOT_FOUND" }
      return { ok: false, error: msg, code: "BROWSER_ERROR" }
    }
  }

  async fill(refOrSelector: string, text: string): Promise<CdpResult> {
    try {
      const nodeInfo = await this.resolveNode(refOrSelector)
      if (!nodeInfo) return { ok: false, error: "ELEMENT_NOT_FOUND" }

      const { x, y } = nodeInfo.center
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      })
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      })

      // 可靠清空：Ctrl+A 在自定义/受控组件上常失效，导致 fill 变成追加拼接。
      // 改用 JS 直接清空 value 并派发 input 事件（React/Vue 受控组件友好）。
      await this.clearElement(refOrSelector, nodeInfo.backendNodeId)

      // 输入：单次 Input.insertText（agent-browser 注释：VS Code/Electron webview
      // 拒绝重复 printable dispatchKeyEvent，printable 走 insertText 更可靠）
      await this.sendCommand("Input.insertText", { text })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async drag(sourceRef: string, targetRef: string): Promise<CdpResult> {
    try {
      await this.scrollIntoView(sourceRef)
      const src = await this.resolveNode(sourceRef)
      if (!src)
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      await this.scrollIntoView(targetRef)
      const tgt = await this.resolveNode(targetRef)
      if (!tgt)
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      const sx = src.center.x,
        sy = src.center.y
      const tx = tgt.center.x,
        ty = tgt.center.y
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: sx,
        y: sy,
      })
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: sx,
        y: sy,
        button: "left",
        buttons: 1,
        clickCount: 1,
      })
      // 零距离：source 与 target 同点，跳过 10 步插值（否则在原地发 10 次多余的 mouseMoved）
      if (sx !== tx || sy !== ty) {
        for (let i = 1; i <= 10; i++) {
          const cx = sx + ((tx - sx) * i) / 10
          const cy = sy + ((ty - sy) * i) / 10
          await this.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: cx,
            y: cy,
            button: "left",
            buttons: 1,
          })
          await new Promise((r) => setTimeout(r, 10))
        }
      }
      await this.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: tx,
        y: ty,
        button: "left",
        buttons: 0,
        clickCount: 1,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  async upload(
    refOrSelector: string,
    files: string[]
  ): Promise<CdpResult<{ uploaded: number }>> {
    try {
      const abs = files.map((f) => path.resolve(f))
      for (const f of abs) {
        if (!fs.existsSync(f))
          return {
            ok: false,
            error: `file not found: ${f}`,
            code: "FILE_NOT_FOUND",
          }
      }
      if (refOrSelector.startsWith("@e")) {
        const node = await this.resolveNode(refOrSelector)
        if (!node?.backendNodeId) {
          return {
            ok: false,
            error: "ELEMENT_NOT_FOUND",
            code: "ELEMENT_NOT_FOUND",
          }
        }
        await this.sendCommand("DOM.setFileInputFiles", {
          files: abs,
          backendNodeId: node.backendNodeId,
        })
        return { ok: true, data: { uploaded: abs.length } }
      }
      // 选择器路径：Runtime.evaluate 取元素 objectId，再用 objectId 调 setFileInputFiles
      const escaped = refOrSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
      const evalResult = (await this.sendCommand("Runtime.evaluate", {
        expression: `document.querySelector('${escaped}')`,
      })) as { result?: { objectId?: string } }
      const objectId = evalResult.result?.objectId
      if (!objectId)
        return {
          ok: false,
          error: "ELEMENT_NOT_FOUND",
          code: "ELEMENT_NOT_FOUND",
        }
      await this.sendCommand("DOM.setFileInputFiles", { files: abs, objectId })
      return { ok: true, data: { uploaded: abs.length } }
    } catch (e) {
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  // 按键派发：可选先点中目标元素聚焦，再发 keyDown/(char)/keyUp。
  // 单字符且无 ctrl/alt/meta 时补一个 char 事件，让可输入元素真正收到字符。
  async press(
    key: string,
    modifiers: Record<string, boolean>,
    refOrSelector?: string
  ): Promise<CdpResult> {
    try {
      if (refOrSelector) {
        const node = await this.resolveNode(refOrSelector)
        if (node) {
          const { x, y } = node.center
          await this.sendCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            clickCount: 1,
          })
          await this.sendCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            clickCount: 1,
          })
        }
      }
      const k = resolveKey(key)
      const mods = modBits(modifiers)
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.keyCode,
        modifiers: mods,
      })
      if (
        key.length === 1 &&
        !modifiers.ctrl &&
        !modifiers.alt &&
        !modifiers.meta
      ) {
        await this.sendCommand("Input.dispatchKeyEvent", {
          type: "char",
          text: key,
        })
      }
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: k.key,
        code: k.code,
        windowsVirtualKeyCode: k.keyCode,
        modifiers: mods,
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /**
   * 清空输入框内容。Ctrl+A 全选在很多受控/自定义组件上不可靠，故直接用 JS：
   * 通过原型 value setter 置空并派发 input 事件，让 React/Vue 等框架同步状态。
   * @eN 走 DOM.resolveNode → callFunctionOn；selector 走 Runtime.evaluate。
   * 清空失败不抛错（退化为追加，但不中断 fill）。
   */
  private async clearElement(
    refOrSelector: string,
    backendNodeId: number
  ): Promise<void> {
    const clearBody = `
      el.focus();
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        const proto = tag === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (el.isContentEditable) {
        el.textContent = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `
    try {
      if (backendNodeId) {
        const resolved = (await this.sendCommand("DOM.resolveNode", {
          backendNodeId,
        })) as { object?: { objectId?: string } }
        const objectId = resolved.object?.objectId
        if (!objectId) return
        await this.sendCommand("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: `function() { const el = this; ${clearBody} }`,
        })
      } else {
        const escaped = refOrSelector
          .replace(/\\/g, "\\\\")
          .replace(/'/g, "\\'")
        await this.sendCommand("Runtime.evaluate", {
          expression: `(() => { const el = document.querySelector('${escaped}'); if (!el) return; ${clearBody} })()`,
        })
      }
    } catch {
      /* 清空失败不阻断后续输入 */
    }
  }

  /** 在 refOrSelector 元素上执行 JS（this=el），返回 returnByValue 结果。 */
  private async runOnElement(
    refOrSelector: string,
    funcBody: string
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

  /**
   * 选择原生 <select> 下拉项：按 value 精确匹配或 label（option 文本）匹配，
   * 命中后派发 input/change 事件让框架同步状态。返回是否命中。
   */
  async select(
    refOrSelector: string,
    opts: { value?: string; label?: string }
  ): Promise<CdpResult> {
    try {
      const v = JSON.stringify(opts.value ?? null)
      const lbl = JSON.stringify(opts.label ?? null)
      const ok = await this.runOnElement(
        refOrSelector,
        `
        if (el.tagName !== 'SELECT') return false;
        const value=${v}, label=${lbl};
        let matched=false;
        for (const o of el.options) {
          if ((value!=null && o.value===value) || (label!=null && o.textContent.trim()===label)) { el.value=o.value; matched=true; break; }
        }
        if (matched) { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
        return matched;
      `
      )
      return ok
        ? { ok: true }
        : { ok: false, error: "option not found", code: "OPTION_NOT_FOUND" }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /**
   * 读元素当前值：优先 `el.value`（input/textarea/select 的实时值），
   * 回退到 `value` 属性。用于校验 fill/select 是否落地。
   */
  async getValue(
    refOrSelector: string
  ): Promise<CdpResult<{ value: string | null }>> {
    try {
      const v = await this.runOnElement(
        refOrSelector,
        "return (el.value != null ? String(el.value) : (el.getAttribute('value') ?? null));"
      )
      return { ok: true, data: { value: (v as string | null) ?? null } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** 读元素指定属性（如 href/src/aria-*）；属性不存在返回 null。 */
  async getAttribute(
    refOrSelector: string,
    name: string
  ): Promise<CdpResult<{ value: string | null }>> {
    try {
      const v = await this.runOnElement(
        refOrSelector,
        `return el.getAttribute(${JSON.stringify(name)});`
      )
      return { ok: true, data: { value: (v as string | null) ?? null } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** 等待页面 readyState=complete；超时返回 ok:false（调用方可选择忽略） */
  async waitForReady(timeoutMs = 10_000): Promise<CdpResult> {
    try {
      await this.waitForLoadComplete(timeoutMs)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /**
   * 轮询等待条件满足：
   * - selector：document.querySelector 命中
   * - text：document.body.innerText 包含
   * - 都不传：等待 readyState=complete
   * 用 JSON.stringify 安全转义，避免引号/特殊字符注入。
   */
  async waitFor(opts: {
    selector?: string
    text?: string
    timeoutMs?: number
  }): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const timeoutMs = opts.timeoutMs ?? 10_000
    const expression = opts.selector
      ? `!!document.querySelector(${JSON.stringify(opts.selector)})`
      : opts.text
        ? `(document.body?.innerText || "").includes(${JSON.stringify(opts.text)})`
        : `document.readyState === "complete"`
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", {
          expression,
          returnByValue: true,
        })) as { result?: { value?: boolean } }
        if (r.result?.value === true) {
          return {
            ok: true,
            data: { matched: true, waitedMs: Date.now() - start },
          }
        }
      } catch {
        /* retry until timeout */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT" }
  }

  /**
   * 等待网络空闲：先 JS 启发式短路（readyState=complete 且最近资源 >500ms 前），
   * 否则走 Page.lifecycleEvent name="networkIdle" 事件路径。
   * 内部 listener 在 resolve/timeout 时自移除，避免 stale 回调。
   */
  async waitForNetworkIdle(timeoutMs = 10_000): Promise<CdpResult> {
    try {
      await this.sendCommand("Page.enable")
      await this.sendCommand("Network.enable")
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
      return await new Promise<CdpResult>((resolve) => {
        let done = false
        const timer = setTimeout(() => {
          if (done) return
          done = true
          dispose()
          resolve({ ok: false, error: "TIMEOUT", code: "TIMEOUT" })
        }, timeoutMs)
        const dispose = this.addMessageListener(
          (m, p) =>
            m === "Page.lifecycleEvent" &&
            (p as { name?: string }).name === "networkIdle",
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
      return { ok: false, error: (e as Error).message, code: "BROWSER_ERROR" }
    }
  }

  /** glob 匹配当前 URL（* → .*，? → .）；200ms 轮询。 */
  async waitForUrl(
    pattern: string,
    timeoutMs = 10_000
  ): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const re = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$"
    )
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", {
          expression: "window.location.href",
          returnByValue: true,
        })) as { result?: { value?: string } }
        if (re.test(r.result?.value ?? "")) {
          return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }

  /** 轮询 JS 表达式，返回 truthy 即满足；200ms 轮询。 */
  async waitForFunction(
    js: string,
    timeoutMs = 10_000
  ): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", {
          expression: js,
          returnByValue: true,
        })) as { result?: { value?: boolean } }
        if (r.result?.value === true) {
          return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }

  /**
   * 等待元素可见/隐藏状态。
   * visible：document.querySelector 命中即满足。
   * hidden：元素不存在，或 getComputedStyle display:none / visibility:hidden。
   */
  async waitForState(
    selector: string,
    state: "visible" | "hidden",
    timeoutMs = 10_000
  ): Promise<CdpResult<{ matched: boolean; waitedMs: number }>> {
    const escaped = selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
    const expr =
      state === "hidden"
        ? `(() => { const el = document.querySelector('${escaped}'); if (!el) return true; const cs = getComputedStyle(el); return cs.display === 'none' || cs.visibility === 'hidden'; })()`
        : `!!document.querySelector('${escaped}')`
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", {
          expression: expr,
          returnByValue: true,
        })) as { result?: { value?: boolean } }
        if (r.result?.value === true) {
          return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
        }
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT", code: "TIMEOUT" }
  }

  async extractText(): Promise<CdpResult<{ text: string }>> {
    try {
      const result = (await this.sendCommand("Runtime.evaluate", {
        expression: "document.body?.innerText || ''",
        returnByValue: true,
      })) as { result?: { value?: string } }
      return { ok: true, data: { text: result.result?.value ?? "" } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async screenshot(): Promise<CdpResult<{ base64: string }>> {
    try {
      const result = (await this.sendCommand("Page.captureScreenshot", {
        format: "png",
      })) as { data?: string }
      return { ok: true, data: { base64: result.data ?? "" } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async getUrl(): Promise<CdpResult<{ url: string }>> {
    try {
      const result = (await this.sendCommand("Runtime.evaluate", {
        expression: "window.location.href",
        returnByValue: true,
      })) as { result?: { value?: string } }
      return { ok: true, data: { url: result.result?.value ?? "" } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async getTitle(): Promise<string> {
    try {
      const result = (await this.sendCommand("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      })) as { result?: { value?: string } }
      return result.result?.value ?? ""
    } catch {
      return ""
    }
  }

  private async waitForLoadComplete(timeoutMs: number): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await this.sendCommand("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        })) as { result?: { value?: string } }
        if (r.result?.value === "complete") return
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error("TIMEOUT")
  }

  private async resolveNode(
    refOrSelector: string
  ): Promise<{
    backendNodeId: number
    center: { x: number; y: number }
  } | null> {
    if (refOrSelector.startsWith("@e")) {
      let found = this.refCache.find((r) => r.ref === refOrSelector)
      if (!found) {
        const snap = await this.snapshot()
        if (!snap.ok || !snap.data) return null
        found = snap.data.refs.find((r) => r.ref === refOrSelector)
      }
      if (!found) return null
      const bbox = await this.getBbox(found.backendNodeId)
      if (!bbox) return null
      return { backendNodeId: found.backendNodeId, center: bbox.center }
    }

    const escaped = refOrSelector.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
    const evalResult = (await this.sendCommand("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('${escaped}')
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x + r.width/2, y: r.y + r.height/2 }
      })()`,
      returnByValue: true,
    })) as { result?: { value?: { x: number; y: number } | null } }
    const val = evalResult.result?.value
    if (!val) return null
    return { backendNodeId: 0, center: { x: val.x, y: val.y } }
  }

  private async getBbox(
    backendNodeId: number
  ): Promise<{ center: { x: number; y: number } } | null> {
    if (!backendNodeId) return null
    try {
      const dom = (await this.sendCommand("DOM.getBoxModel", {
        backendNodeId,
      })) as { model?: { content?: number[] } }
      const content = dom.model?.content
      if (!content || content.length < 8) return null
      const xs = [content[0], content[2], content[4], content[6]]
      const ys = [content[1], content[3], content[5], content[7]]
      return {
        center: {
          x: (Math.min(...xs) + Math.max(...xs)) / 2,
          y: (Math.min(...ys) + Math.max(...ys)) / 2,
        },
      }
    } catch {
      return null
    }
  }
}

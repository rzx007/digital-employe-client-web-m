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

function resolveKey(key: string): { key: string; code: string; keyCode: number } {
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
  return (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0)
}

export class BrowserController {
  private refCache: RefNode[] = []

  // 纯命令逻辑：只依赖 transport(CDP 收发)。宿主集成(confirm/ensureBrowser/
  // afterClick/close/会话/产物路径)由 createBridge 持有的 Host 负责，不进 controller。
  constructor(private transport: Transport) {}

  private async sendCommand(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    return this.transport.sendCommand(method, params)
  }

  async navigate(url: string): Promise<CdpResult<{ url: string; title: string }>> {
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

  async snapshot(maxNodes = 200): Promise<CdpResult<{ refs: RefNode[] }>> {
    try {
      await this.sendCommand("Accessibility.enable")
      // 主 frame：a11y 树惰性构建，轮询直到 RootWebArea 暴露子节点或超时 3s
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

      // 子 frame：同源/in-process 能取到树→拼入；跨源 OOPIF 取不到→跳过、不崩
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
            // 跨源 OOPIF 单 session 取不到树属预期；记 debug 以便与真实 CDP 异常区分
            skippedFrames++
            logger.debug("[browser-debugger] snapshot frame skipped", {
              frameId,
              err: (err as Error).message,
            })
          }
        }
      } catch (e) {
        // getFrameTree 失败：退化为仅主 frame，不影响主流程
        logger.warn("[browser-debugger] getFrameTree failed, main-frame only", {
          err: (e as Error).message,
        })
      }

      const refs = buildRefs(framesNodes, maxNodes)
      this.refCache = refs
      logger.info("[browser-debugger] snapshot", {
        frames: framesNodes.length,
        skippedFrames,
        mainRawNodes: mainNodes.length,
        rootChildCount,
        refs: refs.length,
        truncated: refs.length >= maxNodes,
      })
      return { ok: true, data: { refs } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // 把目标滚进视口中心。@eN 走 DOM.resolveNode → callFunctionOn；
  // selector 走 Runtime.evaluate。失败静默（调用方据 resolveNode 已有兜底）。
  async scrollIntoView(refOrSelector: string): Promise<void> {
    const node = await this.resolveNode(refOrSelector)
    if (!node?.backendNodeId) {
      const escaped = refOrSelector
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
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

      for (const char of text) {
        await this.sendCommand("Input.dispatchKeyEvent", {
          type: "char",
          text: char,
        })
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
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
          return { ok: true, data: { matched: true, waitedMs: Date.now() - start } }
        }
      } catch {
        /* retry until timeout */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    return { ok: false, error: "TIMEOUT" }
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
  ): Promise<{ backendNodeId: number; center: { x: number; y: number } } | null> {
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

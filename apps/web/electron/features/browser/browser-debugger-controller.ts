import type { WebContents } from "electron"

import { rootLogger as logger } from "../../core/logger"

export interface RefNode {
  ref: string
  role: string
  name: string | null
  value: string | null
  backendNodeId: number
  depth: number
}

export interface CdpResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}

const MASKED_ROLES = new Set(["password"])

export class BrowserDebuggerController {
  private wc: WebContents | null = null
  private attached = false
  private refCache: RefNode[] = []

  attach(webContents: WebContents): boolean {
    if (webContents.isDestroyed()) return false
    if (this.attached && this.wc === webContents) return true
    this.detach()
    try {
      if (webContents.debugger.isAttached()) {
        webContents.debugger.detach()
      }
      webContents.debugger.attach("1.3")
      this.wc = webContents
      this.attached = true
      return true
    } catch (err) {
      logger.warn("[browser-debugger] attach failed", {
        error: String(err),
      })
      return false
    }
  }

  detach(): void {
    if (this.attached && this.wc && !this.wc.isDestroyed()) {
      try {
        if (this.wc.debugger.isAttached()) {
          this.wc.debugger.detach()
        }
      } catch {
        /* ignore */
      }
    }
    this.attached = false
    this.wc = null
    this.refCache = []
  }

  isAttached(): boolean {
    return (
      this.attached &&
      this.wc !== null &&
      !this.wc.isDestroyed() &&
      this.wc.debugger.isAttached()
    )
  }

  private async sendCommand(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<unknown> {
    if (!this.isAttached() || !this.wc) {
      throw new Error("BROWSER_UNAVAILABLE")
    }
    return this.wc.debugger.sendCommand(method, params)
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
      const result = (await this.sendCommand(
        "Accessibility.getFullAXTree"
      )) as { nodes?: unknown[] }
      const refs = this.buildRefs(result.nodes ?? [], maxNodes)
      this.refCache = refs
      return { ok: true, data: { refs } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async click(refOrSelector: string): Promise<CdpResult> {
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

      const mod = process.platform === "darwin" ? 4 : 2
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyDown",
        key: "a",
        code: "KeyA",
        modifiers: mod,
      })
      await this.sendCommand("Input.dispatchKeyEvent", {
        type: "keyUp",
        key: "a",
        code: "KeyA",
        modifiers: mod,
      })

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
      if (this.wc && !this.wc.isDestroyed()) {
        return { ok: true, data: { url: this.wc.getURL() } }
      }
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
      if (this.wc && !this.wc.isDestroyed()) {
        return this.wc.getTitle()
      }
      const result = (await this.sendCommand("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      })) as { result?: { value?: string } }
      return result.result?.value ?? ""
    } catch {
      return ""
    }
  }

  getWebContents(): WebContents | null {
    return this.wc && !this.wc.isDestroyed() ? this.wc : null
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

  private buildRefs(nodes: unknown[], maxNodes: number): RefNode[] {
    const refs: RefNode[] = []
    let counter = 0

    const nodeMap = new Map<number, AxNode>()
    for (const n of nodes) {
      const node = n as AxNode
      if (typeof node.nodeId === "number") nodeMap.set(node.nodeId, node)
    }

    const walk = (node: AxNode, depth: number) => {
      if (refs.length >= maxNodes) return
      const role = node.role?.value ?? "generic"
      if (node.ignored) return
      if (MASKED_ROLES.has(role)) {
        refs.push({
          ref: `@e${counter++}`,
          role,
          name: "[masked]",
          value: null,
          backendNodeId: node.backendDOMNodeId ?? 0,
          depth,
        })
        return
      }
      if (
        ["presentation", "none"].includes(role) &&
        !node.name?.value &&
        depth > 2
      ) {
        return
      }

      refs.push({
        ref: `@e${counter++}`,
        role,
        name: node.name?.value ?? null,
        value: node.value?.value ?? null,
        backendNodeId: node.backendDOMNodeId ?? 0,
        depth,
      })

      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId)
          if (child) walk(child, depth + 1)
        }
      }
    }

    const root = nodes.find(
      (n) => (n as AxNode).role?.value === "RootWebArea"
    ) as AxNode | undefined
    if (root) walk(root, 0)
    else for (const n of nodes) walk(n as AxNode, 0)

    return refs
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

interface AxNode {
  nodeId?: number
  ignored?: boolean
  role?: { value?: string }
  name?: { value?: string }
  value?: { value?: string }
  backendDOMNodeId?: number
  childIds?: number[]
}

let debuggerController: BrowserDebuggerController | null = null

export function getBrowserDebuggerController(): BrowserDebuggerController {
  if (!debuggerController) {
    debuggerController = new BrowserDebuggerController()
  }
  return debuggerController
}

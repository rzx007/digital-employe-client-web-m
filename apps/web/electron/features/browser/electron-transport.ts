import type { WebContents } from "electron"
import type { Transport } from "@workspace/browser-sdk"

// 用 webContents.debugger 实现 Transport。wc 由 ensureBrowser 时注入。
export class ElectronDebuggerTransport implements Transport {
  private wc: WebContents | null = null
  private msgCb: ((m: string, p: unknown, s?: string) => void) | null = null

  setWebContents(wc: WebContents): void { this.wc = wc }

  async attach(): Promise<void> {
    if (!this.wc || this.wc.isDestroyed()) throw new Error("BROWSER_UNAVAILABLE")
    // 同 wc 已附加（含 message listener）→ 短路，避免 per-action attach 累积 listener
    if (this.wc.debugger.isAttached()) return
    this.wc.debugger.attach("1.3")
    this.wc.debugger.removeAllListeners("message") // 清旧 wc / 旧附加周期遗留
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

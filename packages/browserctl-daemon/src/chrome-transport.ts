import CDP from "chrome-remote-interface"
import type { Transport } from "@workspace/browser-sdk"

export class ChromeCdpTransport implements Transport {
  private client: CDP.Client | null = null
  private msgCb: ((m: string, p: unknown, s?: string) => void) | null = null

  constructor(private opts: { port: number }) {}

  async attach(): Promise<void> {
    if (this.client !== null) return // 幂等：已连接则短路，避免覆盖旧 client 泄漏 WebSocket
    // Chrome 的 CDP endpoint 在 launch 返回后可能还需数百 ms 才就绪（尤其有头），
    // chrome-remote-interface 不自带重试，这里重试直到连上或超时（约 5s）。
    let lastErr: unknown
    for (let i = 0; i < 20; i++) {
      try {
        this.client = await CDP({ port: this.opts.port })
        break
      } catch (e) {
        lastErr = e
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    if (this.client === null) throw lastErr
    this.client.on("event", (msg: CDP.EventMessage) => {
      this.msgCb?.(msg.method, msg.params, msg.sessionId)
    })
  }

  async detach(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
    }
  }

  isAttached(): boolean {
    return this.client !== null
  }

  on(_e: "message", cb: (m: string, p: unknown, s?: string) => void): void {
    this.msgCb = cb
  }

  async sendCommand(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!this.client) throw new Error("BROWSER_UNAVAILABLE")
    // chrome-remote-interface send() 的第一参数要求 keyof Commands（已知 CDP 方法名），
    // 此处 method 是运行时动态字符串，用 as any 做动态分发。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this.client.send as (m: string, p: Record<string, unknown>) => Promise<unknown>)(
      method,
      params,
    )
  }
}

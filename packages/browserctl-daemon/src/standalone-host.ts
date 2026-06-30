import path from "node:path"
import type { Host } from "@workspace/browser-sdk"

// 独立 daemon 的 Host：无 Electron UI。confirm 放行+审计日志；ensureBrowser/ensureAttached no-op
// (daemon 启动时已 launch Chrome 并 attach transport，浏览器保持连接)。
export class StandaloneHost implements Host {
  private log: (m: string) => void
  constructor(opts: { logger?: (m: string) => void } = {}) {
    this.log = opts.logger ?? ((m) => console.error(m))
  }
  async requestConfirmation(message: string, _screenshotBase64?: string): Promise<boolean> {
    this.log(`[browserctl] 独立后端放行敏感动作(--confirm): ${message}`)
    return true
  }
  resolveArtifactPath(nameOrPath: string): string {
    return path.isAbsolute(nameOrPath) ? nameOrPath : path.resolve(process.cwd(), nameOrPath)
  }
  async ensureBrowser(_url?: string): Promise<void> {}
  async ensureAttached(): Promise<void> {}
  async close(): Promise<void> {}
}

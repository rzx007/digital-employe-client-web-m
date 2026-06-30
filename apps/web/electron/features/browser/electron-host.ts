import type { WebContents } from "electron"

import type { Host } from "@workspace/browser-sdk"
import { getWindowManager } from "../../core/services/window-registry"
import { getBrowserController } from "./window-controller"
import { requestBrowserConfirmation } from "./browser-confirmation"
import { flashHighlight } from "./browser-highlight"
import type { ElectronDebuggerTransport } from "./electron-transport"

// ── helpers (ported from browser-http-bridge, kept module-private) ──────────

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function notifyRequestOpen(url: string, conversationId: string | null): void {
  const main = getWindowManager().get("main")
  if (main && !main.isDestroyed()) {
    main.webContents.send("browser:request-open", { url, conversationId })
  }
}

async function waitForBrowserWebContents(
  timeoutMs: number
): Promise<WebContents | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const wc = getBrowserController().getBrowserWebContents()
    if (wc && !wc.isDestroyed()) return wc
    await delay(50)
  }
  return getBrowserController().getBrowserWebContents()
}

// ── ElectronHost ─────────────────────────────────────────────────────────────

export class ElectronHost implements Host {
  private activeConversationId: string | null = null

  constructor(private transport: ElectronDebuggerTransport) {}

  async requestConfirmation(message: string): Promise<boolean> {
    // Host 接口只传 message；refOrSelector 在此上下文无具体目标，置空串。
    // 视图压制由 beforeInteraction / afterClick 在 controller 层管理。
    return requestBrowserConfirmation({
      message,
      refOrSelector: "",
      conversationId: this.activeConversationId,
    })
  }

  resolveArtifactPath(nameOrPath: string): string {
    // Electron 侧截图由 CLI 写盘，产物目录解析由上层 workspace 逻辑负责。
    // 此处直通，与 bridge 层行为对齐（bridge 不做路径转换）。
    return nameOrPath
  }

  /**
   * 确保内嵌浏览器就绪并 attach debugger transport。
   * 完整移植 browser-http-bridge.ts `handleNavigate` 的 Electron glue（六步）：
   *  1. notifyRequestOpen — 通知 renderer 摊开右栏
   *  2. delay(120)        — 给 renderer 布局时间
   *  3. waitForBrowserWebContents(5000) — 轮询视口
   *  4. 若仍无 wc → controller.open(url) → waitForBrowserWebContents(2000)
   *  5. 仍无 wc → throw BROWSER_UNAVAILABLE
   *  6. prepareViewportForBridge() → setWebContents + attach
   */
  async ensureBrowser(url?: string): Promise<void> {
    const controller = getBrowserController()
    const targetUrl = url ?? ""

    // Step 1: 通知 renderer 展开浏览器侧栏（browser:request-open）
    notifyRequestOpen(targetUrl, this.activeConversationId)

    // Step 2: 等待 renderer 布局
    await delay(120)

    // Step 3: 轮询等待 WebContents（前台已展开场景）
    let wc = await waitForBrowserWebContents(5000)

    // Step 4: 若前台未就绪则强制打开再等一轮（2000 ms，与 bridge 一致）
    if (!wc) {
      controller.open(targetUrl)
      wc = await waitForBrowserWebContents(2000)
    }

    // Step 5: 超时仍无 wc → 不可用
    if (!wc) {
      throw new Error("BROWSER_UNAVAILABLE")
    }

    // Step 6: 准备视口（布局/bounds）→ 更新 wc 引用 → attach transport
    const preparedWc = await controller.prepareViewportForBridge()
    this.transport.setWebContents(preparedWc)
    await this.transport.attach()
  }

  async close(): Promise<void> {
    await this.transport.detach()
    getBrowserController().close()
    const main = getWindowManager().get("main")
    if (main && !main.isDestroyed()) {
      main.webContents.send("browser:request-close", {
        conversationId: this.activeConversationId ?? null,
      })
    }
  }

  beforeInteraction(): void {
    // 确认弹窗/交互前：压制内嵌浏览器视图（让 React 层置顶）
    getBrowserController().setVisibilitySuppressed(true)
  }

  afterClick(refOrSelector: string): void {
    const wc = getBrowserController().getBrowserWebContents()
    if (wc) void flashHighlight(wc, refOrSelector)
  }

  setActiveSession(id: string): void {
    this.activeConversationId = id
    getBrowserController().setActiveConversationId(id)
  }
}

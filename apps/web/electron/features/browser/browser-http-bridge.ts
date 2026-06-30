import http from "node:http"

import { BrowserController, createBridge } from "@workspace/browser-sdk"
import { ElectronDebuggerTransport } from "./electron-transport"
import { ElectronHost } from "./electron-host"
import { getBrowserController } from "./window-controller"

const DEFAULT_PORT = 34555

export function startBrowserHttpBridge(port = DEFAULT_PORT): http.Server {
  const transport = new ElectronDebuggerTransport()
  const host = new ElectronHost(transport)
  const controller = new BrowserController(transport)
  return createBridge(controller, host, {
    port,
    health: async () => {
      const wc = getBrowserController().getBrowserWebContents()
      const available = Boolean(wc && !wc.isDestroyed())
      return {
        ok: true,
        data: {
          electron_up: true,
          bridge_port: DEFAULT_PORT,
          session: "default",
          browser_available: available,
          url: available ? wc!.getURL() : "",
          title: available ? wc!.getTitle() : "",
          // 从源头消除「browser_available:false 被当门禁」的误判：该字段只表示**此刻视口
          // 是否已创建**（惰性创建：只有 open/navigate 才建，health 自己永不创建），不代表
          // 浏览器能否使用。派单/后台会话里它如实为 false 是正常态。无论哪个技能、模型怎么
          // 推理，拿到 health 输出就看到这句引导，不依赖技能文档写对。
          hint: available
            ? "浏览器视口已就绪，可直接 open/navigate/extract-text。"
            : "browser_available=false 仅表示视口尚未创建（惰性创建，正常态），并非浏览器不可用。请直接 `browserctl open <url>`（会按需创建），切勿据此转用 Python/requests 抓页面。只有 open/navigate 本身返回 ok:false 才说明真不可用。",
        },
      }
    },
  })
}

import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

import { rootLogger as logger } from "../../core/logger"
import { getWindowManager } from "../../core/services/window-registry"
import { getBrowserController } from "./window-controller"
import { getBrowserDebuggerController } from "./browser-debugger-controller"
import { requestBrowserConfirmation } from "./browser-confirmation"
import { flashHighlight } from "./browser-highlight"

const DEFAULT_PORT = 58555
const DEFAULT_SESSION = "default"

type JsonBody = Record<string, unknown>

function readJson(req: IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on("data", (c) => chunks.push(c))
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw) as JsonBody)
      } catch (e) {
        reject(e)
      }
    })
    req.on("error", reject)
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function parsePath(url: string): {
  sessionId: string
  action: string
} | null {
  const match = url.match(/^\/internal\/browser\/([^/]+)\/([^/?]+)/)
  if (!match) return null
  return { sessionId: match[1], action: match[2] }
}

function notifyRequestOpen(url: string): void {
  const main = getWindowManager().get("main")
  if (main && !main.isDestroyed()) {
    main.webContents.send("browser:request-open", { url })
  }
}

function ensureBrowserSession(sessionId: string): boolean {
  if (sessionId !== DEFAULT_SESSION) return false
  const controller = getBrowserController()
  const win = controller.getBrowserWebContents()
  if (!win) {
    controller.open("about:blank")
  }
  return true
}

function attachDebugger(): boolean {
  const wc = getBrowserController().getBrowserWebContents()
  if (!wc) return false
  return getBrowserDebuggerController().attach(wc)
}

export function startBrowserHttpBridge(port = DEFAULT_PORT): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" })
      return
    }

    const path = req.url?.split("?")[0] ?? ""
    const parsed = parsePath(path)
    if (!parsed) {
      sendJson(res, 404, { ok: false, error: "not found" })
      return
    }

    const { sessionId, action } = parsed
    if (!ensureBrowserSession(sessionId)) {
      sendJson(res, 404, { ok: false, error: "unknown session" })
      return
    }

    if (!attachDebugger()) {
      sendJson(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
      return
    }

    let body: JsonBody = {}
    try {
      body = await readJson(req)
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid json" })
      return
    }

    const dbg = getBrowserDebuggerController()
    const wc = dbg.getWebContents()

    try {
      switch (action) {
        case "navigate": {
          const url = String(body.url ?? "")
          if (!url) {
            sendJson(res, 400, { ok: false, error: "url required" })
            return
          }
          getBrowserController().open(url)
          notifyRequestOpen(url)
          attachDebugger()
          const result = await dbg.navigate(url)
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "snapshot": {
          const maxNodes =
            typeof body.max_nodes === "number" ? body.max_nodes : 200
          const result = await dbg.snapshot(maxNodes)
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "click": {
          const refOrSelector = String(body.ref_or_selector ?? "")
          const confirmationRequired = Boolean(body.confirmation_required)
          const confirmationMessage = String(
            body.confirmation_message ??
              body.message ??
              `确认点击「${refOrSelector}」？`
          )

          if (confirmationRequired) {
            const shot = await dbg.screenshot()
            const approved = await requestBrowserConfirmation({
              message: confirmationMessage,
              refOrSelector,
              screenshotBase64: shot.ok ? shot.data?.base64 : undefined,
            })
            if (!approved) {
              sendJson(res, 200, { ok: false, error: "USER_CANCELLED" })
              return
            }
          }

          const result = await dbg.click(refOrSelector)
          if (result.ok && wc && !refOrSelector.startsWith("@e")) {
            void flashHighlight(wc, refOrSelector)
          }
          if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
            sendJson(res, 404, result)
            return
          }
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "fill": {
          const refOrSelector = String(body.ref_or_selector ?? "")
          const text = String(body.text ?? "")
          const result = await dbg.fill(refOrSelector, text)
          if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
            sendJson(res, 404, result)
            return
          }
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "extract-text": {
          const result = await dbg.extractText()
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "screenshot": {
          const result = await dbg.screenshot()
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "get-url": {
          const result = await dbg.getUrl()
          sendJson(res, result.ok ? 200 : 502, result)
          return
        }
        case "get-title": {
          const title = await dbg.getTitle()
          sendJson(res, 200, { ok: true, data: { title } })
          return
        }
        default:
          sendJson(res, 404, { ok: false, error: "unknown action" })
      }
    } catch (e) {
      logger.warn(`[browser-http] ${action} failed`, { error: String(e) })
      sendJson(res, 500, { ok: false, error: String(e) })
    }
  })

  server.listen(port, "127.0.0.1", () => {
    logger.info(`[browser-http] listening on http://127.0.0.1:${port}`)
  })

  server.on("error", (err) => {
    logger.error("[browser-http] server error", { error: String(err) })
  })

  return server
}

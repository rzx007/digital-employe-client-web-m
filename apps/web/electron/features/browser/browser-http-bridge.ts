import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

import type { WebContents } from "electron"

import { rootLogger as logger } from "../../core/logger"
import { getWindowManager } from "../../core/services/window-registry"
import { getBrowserController } from "./window-controller"
import { getBrowserDebuggerController } from "./browser-debugger-controller"
import { requestBrowserConfirmation } from "./browser-confirmation"
import { flashHighlight } from "./browser-highlight"

const DEFAULT_PORT = 34555
const DEFAULT_SESSION = "default"
const NAVIGATE_LOAD_TIMEOUT_MS = 45_000
const NAVIGATE_VIEWPORT_WAIT_MS = 5_000

type JsonBody = Record<string, unknown>
type BrowserResponse<T = unknown> = {
  ok: boolean
  data?: T
  error?: string
  code?: string
}

function errorCode(message: unknown, fallback = "BROWSER_ERROR"): string {
  const raw = String(message || fallback)
  if (raw.includes("BROWSER_UNAVAILABLE")) return "BROWSER_UNAVAILABLE"
  if (raw.includes("ELEMENT_NOT_FOUND")) return "ELEMENT_NOT_FOUND"
  if (raw.includes("USER_CANCELLED")) return "USER_CANCELLED"
  if (raw.includes("TIMEOUT")) return "TIMEOUT"
  if (raw.includes("BROWSER_VIEWPORT_NOT_READY")) {
    return "BROWSER_VIEWPORT_NOT_READY"
  }
  return fallback
}

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

function normalizeBody(status: number, body: unknown): BrowserResponse {
  if (typeof body !== "object" || body === null) {
    return status >= 400
      ? { ok: false, error: String(body), code: errorCode(body) }
      : { ok: true, data: body }
  }
  const current = body as BrowserResponse
  if (current.ok === false) {
    return {
      ...current,
      code: current.code ?? errorCode(current.error),
    }
  }
  if (current.ok === true) return current
  return { ok: status < 400, data: current }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const normalized = normalizeBody(status, body)
  logger.info("[browser-http] response", {
    status,
    ok: normalized.ok,
    error: normalized.error,
    code: normalized.code,
  })

  if (res.headersSent) return
  const payload = JSON.stringify(normalized)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
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
  return sessionId === DEFAULT_SESSION
}

function handleHealth(res: ServerResponse): void {
  const wc = getBrowserController().getBrowserWebContents()
  reply(res, 200, {
    ok: true,
    data: {
      electron_up: true,
      bridge_port: DEFAULT_PORT,
      session: DEFAULT_SESSION,
      browser_available: Boolean(wc && !wc.isDestroyed()),
      url: wc && !wc.isDestroyed() ? wc.getURL() : "",
      title: wc && !wc.isDestroyed() ? wc.getTitle() : "",
    },
  })
}

function attachDebugger(): boolean {
  const wc = getBrowserController().getBrowserWebContents()
  if (!wc) return false
  return getBrowserDebuggerController().attach(wc)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = "TIMEOUT"
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

async function loadUrlWithTimeout(
  wc: WebContents,
  url: string
): Promise<void> {
  if (wc.isDestroyed()) throw new Error("BROWSER_UNAVAILABLE")
  try {
    await withTimeout(
      wc.loadURL(url),
      NAVIGATE_LOAD_TIMEOUT_MS,
      "TIMEOUT"
    )
  } catch (err: unknown) {
    const msg = String(err)
    if (
      msg.toLowerCase().includes("err_aborted") ||
      msg.includes("(-3)")
    ) {
      return
    }
    throw err
  }
}

function listenWithRetry(server: http.Server, port: number): void {
  const listen = () => {
    if (server.listening) return
    server.listen(port, "127.0.0.1", () => {
      logger.info(`[browser-http] listening on http://127.0.0.1:${port}`)
    })
  }

  server.on("error", (err: NodeJS.ErrnoException) => {
    logger.error("[browser-http] server error", { error: String(err) })
    if (
      err.code === "EADDRINUSE" ||
      err.code === "EACCES" ||
      err.code === "EADDRNOTAVAIL"
    ) {
      setTimeout(listen, 1000).unref()
    }
  })

  listen()
}

async function handleNavigate(
  res: ServerResponse,
  url: string
): Promise<void> {
  const controller = getBrowserController()

  notifyRequestOpen(url)
  await delay(120)

  let wc = await waitForBrowserWebContents(NAVIGATE_VIEWPORT_WAIT_MS)
  if (!wc) {
    controller.open(url)
    wc = await waitForBrowserWebContents(2000)
  }
  if (!wc) {
    reply(res, 503, {
      ok: false,
      error: "BROWSER_UNAVAILABLE",
      code: "BROWSER_UNAVAILABLE",
    })
    return
  }

  try {
    wc = await controller.prepareViewportForBridge()
    await loadUrlWithTimeout(wc, url)
    attachDebugger()
    reply(res, 200, {
      ok: true,
      data: {
        url: wc.getURL(),
        title: wc.getTitle(),
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.warn("[browser-http] navigate failed", { url, error: message })
    reply(res, 502, {
      ok: false,
      error: message,
      code: errorCode(message),
    })
  }
}

async function handleBrowserRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const path = req.url?.split("?")[0] ?? ""

  if (path === "/internal/browser/health") {
    if (req.method !== "GET" && req.method !== "POST") {
      reply(res, 405, {
        ok: false,
        error: "method not allowed",
        code: "METHOD_NOT_ALLOWED",
      })
      return
    }
    handleHealth(res)
    return
  }

  if (req.method !== "POST") {
    reply(res, 405, { ok: false, error: "method not allowed" })
    return
  }

  const parsed = parsePath(path)
  if (!parsed) {
    reply(res, 404, { ok: false, error: "not found" })
    return
  }

  const { sessionId, action } = parsed
  if (!ensureBrowserSession(sessionId)) {
    reply(res, 404, { ok: false, error: "unknown session" })
    return
  }

  let body: JsonBody = {}
  try {
    body = await readJson(req)
  } catch {
    reply(res, 400, { ok: false, error: "invalid json" })
    return
  }

  logger.info("[browser-http] request", {
    action,
    url: typeof body.url === "string" ? body.url : undefined,
  })

  const dbg = getBrowserDebuggerController()

  try {
    switch (action) {
      case "navigate": {
        const url = String(body.url ?? "")
        if (!url) {
          reply(res, 400, { ok: false, error: "url required" })
          return
        }
        await handleNavigate(res, url)
        return
      }
      case "snapshot": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const maxNodes =
          typeof body.max_nodes === "number" ? body.max_nodes : 200
        const result = await dbg.snapshot(maxNodes)
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "click": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const wc = dbg.getWebContents()
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
            reply(res, 200, { ok: false, error: "USER_CANCELLED" })
            return
          }
        }

        const result = await dbg.click(refOrSelector)
        if (result.ok && wc && !refOrSelector.startsWith("@e")) {
          void flashHighlight(wc, refOrSelector)
        }
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "fill": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const text = String(body.text ?? "")
        const result = await dbg.fill(refOrSelector, text)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "extract-text": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const result = await dbg.extractText()
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "screenshot": {
        if (!attachDebugger()) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        const result = await dbg.screenshot()
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "get-url": {
        const wc = getBrowserController().getBrowserWebContents()
        if (!wc) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        reply(res, 200, { ok: true, data: { url: wc.getURL() } })
        return
      }
      case "get-title": {
        const wc = getBrowserController().getBrowserWebContents()
        if (!wc) {
          reply(res, 503, { ok: false, error: "BROWSER_UNAVAILABLE" })
          return
        }
        reply(res, 200, { ok: true, data: { title: wc.getTitle() } })
        return
      }
      default:
        reply(res, 404, { ok: false, error: "unknown action" })
    }
  } catch (e) {
    logger.warn(`[browser-http] ${action} failed`, { error: String(e) })
    reply(res, 500, { ok: false, error: String(e) })
  }
}

export function startBrowserHttpBridge(port = DEFAULT_PORT): http.Server {
  const server = http.createServer((req, res) => {
    void handleBrowserRequest(req, res).catch((err) => {
      logger.warn("[browser-http] unhandled request error", {
        error: String(err),
      })
      reply(res, 500, { ok: false, error: String(err) })
    })
  })

  listenWithRetry(server, port)

  return server
}

import http from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"

import { BrowserController } from "./controller.js"
import type { Host } from "./host.js"

const DEFAULT_PORT = 34555

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
  if (raw.includes("FILE_NOT_FOUND")) return "FILE_NOT_FOUND"
  if (raw.includes("NOT_CHECKABLE")) return "NOT_CHECKABLE"
  if (raw.includes("EVAL_ERROR")) return "EVAL_ERROR"
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

function ensureBrowserSession(sessionId: string): boolean {
  return sessionId.length > 0
}

function sessionToConversationId(sessionId: string): string | null {
  return /^\d+$/.test(sessionId) ? sessionId : null
}

function listenWithRetry(server: http.Server, port: number): void {
  const listen = () => {
    if (server.listening) return
    server.listen(port, "127.0.0.1", () => {
      console.info(`[browser-http] listening on http://127.0.0.1:${port}`)
    })
  }

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("[browser-http] server error", String(err))
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

async function handleBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  controller: BrowserController,
  host: Host,
  healthFn?: () => Promise<unknown>
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
    if (healthFn) {
      try {
        const data = await healthFn()
        reply(res, 200, data)
      } catch (e) {
        reply(res, 500, { ok: false, error: String(e) })
      }
    } else {
      reply(res, 200, { ok: true })
    }
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

  try {
    switch (action) {
      case "navigate": {
        const url = String(body.url ?? "")
        if (!url) {
          reply(res, 400, { ok: false, error: "url required" })
          return
        }
        const convId = sessionToConversationId(sessionId)
        host.setActiveSession?.(convId ?? sessionId)
        try {
          await host.ensureBrowser(url)
          const result = await controller.navigate(url)
          if (!result.ok) {
            reply(res, 502, result)
            return
          }
          // getUrl via CDP for accurate post-navigate URL
          const urlResult = await controller.getUrl()
          const titleResult = await controller.getTitle()
          reply(res, 200, {
            ok: true,
            data: {
              url: urlResult.ok ? (urlResult.data?.url ?? url) : url,
              title: titleResult,
            },
          })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          reply(res, 502, {
            ok: false,
            error: message,
            code: errorCode(message),
          })
        }
        return
      }
      case "snapshot": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const maxNodes =
          typeof body.max_nodes === "number" ? body.max_nodes : 200
        const compact = Boolean(body.compact)
        const maxDepth =
          typeof body.max_depth === "number" ? body.max_depth : undefined
        const scopeSelector =
          typeof body.scope_selector === "string"
            ? body.scope_selector
            : undefined
        const result = await controller.snapshot(maxNodes, {
          compact,
          maxDepth,
          scopeSelector,
        })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "click": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const confirmationRequired = Boolean(body.confirmation_required)
        const confirmationMessage = String(
          body.confirmation_message ??
            body.message ??
            `确认点击「${refOrSelector}」？`
        )

        if (confirmationRequired) {
          const shot = await controller.screenshot()
          const approved = await host.requestConfirmation(
            confirmationMessage,
            shot.ok
              ? (shot.data as { base64?: string } | undefined)?.base64
              : undefined
          )
          if (!approved) {
            reply(res, 200, {
              ok: false,
              error: "USER_CANCELLED",
              code: "USER_CANCELLED",
            })
            return
          }
        }

        const result = await controller.click(refOrSelector)
        if (result.ok && !refOrSelector.startsWith("@e")) {
          host.afterClick?.(refOrSelector)
        }
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "fill": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const text = String(body.text ?? "")
        const result = await controller.fill(refOrSelector, text)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "hover": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.hover(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "dblclick": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.dblclick(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "focus": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.focus(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "type": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const text = String(body.text ?? "")
        const result = await controller.type(refOrSelector, text)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "check":
      case "uncheck": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result =
          action === "check"
            ? await controller.check(refOrSelector)
            : await controller.uncheck(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        if (!result.ok && result.code === "NOT_CHECKABLE") {
          reply(res, 422, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "drag": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const source = String(body.source ?? "")
        const target = String(body.target ?? "")
        if (!source || !target) {
          reply(res, 400, {
            ok: false,
            error: "source and target required",
            code: "BAD_REQUEST",
          })
          return
        }
        const result = await controller.drag(source, target)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "upload": {
        try {
          await host.ensureAttached()
        } catch {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const files = Array.isArray(body.files) ? body.files.map(String) : []
        if (!files.length) {
          reply(res, 400, {
            ok: false,
            error: "files required",
            code: "BAD_REQUEST",
          })
          return
        }
        const result = await controller.upload(refOrSelector, files)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        if (!result.ok && result.code === "FILE_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "select": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const value = typeof body.value === "string" ? body.value : undefined
        const label = typeof body.label === "string" ? body.label : undefined
        const result = await controller.select(refOrSelector, { value, label })
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "press": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const key = String(body.key ?? "")
        const refOrSelector =
          typeof body.ref_or_selector === "string"
            ? body.ref_or_selector
            : undefined
        const m = (body.modifiers ?? {}) as Record<string, boolean>
        const result = await controller.press(key, m, refOrSelector)
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "scroll": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector =
          typeof body.ref_or_selector === "string"
            ? body.ref_or_selector
            : undefined
        const to = typeof body.to === "string" ? body.to : undefined
        const by = typeof body.by === "number" ? body.by : undefined
        const result = await controller.scroll({ refOrSelector, to, by })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "wait": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const selector =
          typeof body.selector === "string" ? body.selector : undefined
        const text = typeof body.text === "string" ? body.text : undefined
        const url = typeof body.url === "string" ? body.url : undefined
        const load = typeof body.load === "string" ? body.load : undefined
        const fn = typeof body.fn === "string" ? body.fn : undefined
        const state = typeof body.state === "string" ? body.state : undefined
        const timeoutMs =
          typeof body.timeout_ms === "number" ? body.timeout_ms : 10_000
        let result
        if (load === "networkidle") {
          result = await controller.waitForNetworkIdle(timeoutMs)
        } else if (load === "load") {
          result = await controller.waitForLoadEvent("load", timeoutMs)
        } else if (load === "domcontentloaded") {
          result = await controller.waitForLoadEvent(
            "DOMContentLoaded",
            timeoutMs
          )
        } else if (url) {
          result = await controller.waitForUrl(url, timeoutMs)
        } else if (fn) {
          result = await controller.waitForFunction(fn, timeoutMs)
        } else if (
          selector &&
          (state === "visible" || state === "hidden")
        ) {
          result = await controller.waitForState(selector, state, timeoutMs)
        } else {
          result = await controller.waitFor({ selector, text, timeoutMs })
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "eval": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const js = typeof body.js === "string" ? body.js : ""
        const timeoutMs =
          typeof body.timeout_ms === "number" ? body.timeout_ms : 10_000
        const result = await controller.evaluateJs(js, timeoutMs)
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "extract-text": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const result = await controller.extractText()
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "screenshot": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const annotate = Boolean(body.annotate)
        const result = await controller.screenshot({ annotate })
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "get-url": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const result = await controller.getUrl()
        reply(res, result.ok ? 200 : 503, result)
        return
      }
      case "get-title": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const title = await controller.getTitle()
        reply(res, 200, { ok: true, data: { title } })
        return
      }
      case "get-value": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.getValue(refOrSelector)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "get-attribute": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const name = String(body.name ?? "")
        const result = await controller.getAttribute(refOrSelector, name)
        if (!result.ok && result.error === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "get-text": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const refOrSelector = String(body.ref_or_selector ?? "")
        const result = await controller.getText(refOrSelector)
        if (!result.ok && result.code === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "is": {
        try {
          await host.ensureAttached()
        } catch (e) {
          reply(res, 503, {
            ok: false,
            error: "BROWSER_UNAVAILABLE",
            code: "BROWSER_UNAVAILABLE",
          })
          return
        }
        const kind = body.kind as string
        const refOrSelector = String(body.ref_or_selector ?? "")
        if (!["visible", "enabled", "checked"].includes(kind)) {
          reply(res, 400, {
            ok: false,
            error: "kind must be visible|enabled|checked",
            code: "CLI_USAGE_ERROR",
          })
          return
        }
        const result = await controller.queryIs(
          kind as "visible" | "enabled" | "checked",
          refOrSelector
        )
        if (!result.ok && result.code === "ELEMENT_NOT_FOUND") {
          reply(res, 404, result)
          return
        }
        reply(res, result.ok ? 200 : 502, result)
        return
      }
      case "close": {
        await host.close()
        reply(res, 200, { ok: true, data: { closed: true } })
        return
      }
      default:
        reply(res, 404, { ok: false, error: "unknown action" })
    }
  } catch (e) {
    console.warn(`[browser-http] ${action} failed`, String(e))
    reply(res, 500, { ok: false, error: String(e) })
  }
}

export function createBridge(
  controller: BrowserController,
  host: Host,
  opts: { port?: number; health?: () => Promise<unknown> } = {}
): http.Server {
  const port = opts.port ?? DEFAULT_PORT
  const healthFn = opts.health

  const server = http.createServer((req, res) => {
    void handleBridgeRequest(req, res, controller, host, healthFn).catch(
      (err) => {
        console.warn("[browser-http] unhandled request error", String(err))
        reply(res, 500, { ok: false, error: String(err) })
      }
    )
  })

  listenWithRetry(server, port)

  return server
}

#!/usr/bin/env node

import http from "node:http"

const VERSION = "0.1.0"
const DEFAULT_BASE_URL =
  process.env.BROWSER_RUNTIME_BRIDGE_URL || "http://127.0.0.1:34555"
const DEFAULT_SESSION = process.env.BROWSER_RUNTIME_SESSION || "default"

function usage() {
  return `browserctl ${VERSION}

Usage:
  browserctl health [--pretty]
  browserctl open <url> [--pretty]
  browserctl navigate <url> [--pretty]
  browserctl snapshot [--max-nodes 200] [--pretty]
  browserctl click <@eN|selector> [--confirm "message"] [--pretty]
  browserctl fill <@eN|selector> <text> [--pretty]
  browserctl get url|title [--pretty]
  browserctl get-url [--pretty]
  browserctl get-title [--pretty]
  browserctl extract-text [--pretty]
  browserctl screenshot [--pretty]

Environment:
  BROWSER_RUNTIME_BRIDGE_URL  default ${DEFAULT_BASE_URL}
  BROWSER_RUNTIME_SESSION     default ${DEFAULT_SESSION}`
}

function parseFlags(argv) {
  const args = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === "--pretty") {
      flags.pretty = true
    } else if (value === "--json") {
      flags.json = true
    } else if (value === "--max-nodes") {
      flags.maxNodes = Number(argv[++i] || 200)
    } else if (value === "--confirm") {
      flags.confirm = argv[++i] || ""
    } else if (value === "--help" || value === "-h") {
      flags.help = true
    } else if (value === "--version" || value === "-v") {
      flags.version = true
    } else {
      args.push(value)
    }
  }
  return { args, flags }
}

function normalizeUrl(input) {
  const value = String(input || "").trim()
  if (!value) return value
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function bridgeUrl(path) {
  return new URL(path, DEFAULT_BASE_URL.replace(/\/$/, ""))
}

function requestJson(method, path, payload = {}) {
  const url = bridgeUrl(path)
  const body = method === "GET" ? "" : JSON.stringify(payload)
  return new Promise((resolve) => {
    const req = http.request(
      url,
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        headers:
          method === "GET"
            ? {}
            : {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Length": Buffer.byteLength(body),
              },
      },
      (res) => {
        const chunks = []
        res.on("data", (chunk) => chunks.push(chunk))
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8").trim()
          if (!raw) {
            resolve({
              ok: false,
              error: `empty response (HTTP ${res.statusCode})`,
              code: "EMPTY_RESPONSE",
            })
            return
          }
          try {
            resolve(JSON.parse(raw))
          } catch {
            resolve({
              ok: false,
              error: `non-json response (HTTP ${res.statusCode}): ${raw.slice(
                0,
                200
              )}`,
              code: "NON_JSON_RESPONSE",
            })
          }
        })
      }
    )
    req.on("error", (error) => {
      resolve({
        ok: false,
        error: `cannot connect browser runtime at ${DEFAULT_BASE_URL}: ${error.message}`,
        code: "BRIDGE_CONNECT_FAILED",
      })
    })
    if (body) req.write(body)
    req.end()
  })
}

function postAction(action, payload) {
  return requestJson(
    "POST",
    `/internal/browser/${encodeURIComponent(DEFAULT_SESSION)}/${action}`,
    payload
  )
}

function print(result, pretty = false) {
  const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
  process.stdout.write(`${output}\n`)
  process.exitCode = result && result.ok === false ? 1 : 0
}

async function run(argv) {
  const { args, flags } = parseFlags(argv)
  const [command, ...rest] = args

  if (flags.version) {
    process.stdout.write(`${VERSION}\n`)
    return
  }
  if (flags.help || !command) {
    process.stdout.write(`${usage()}\n`)
    return
  }

  if (command === "health") {
    print(await requestJson("GET", "/internal/browser/health"), flags.pretty)
    return
  }

  if (command === "open" || command === "navigate") {
    const url = normalizeUrl(rest[0])
    if (!url) throw new Error("url required")
    print(await postAction("navigate", { url }), flags.pretty)
    return
  }

  if (command === "snapshot") {
    print(
      await postAction("snapshot", {
        max_nodes: Number.isFinite(flags.maxNodes) ? flags.maxNodes : 200,
      }),
      flags.pretty
    )
    return
  }

  if (command === "click") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    print(
      await postAction("click", {
        ref_or_selector: refOrSelector,
        confirmation_required: Boolean(flags.confirm),
        confirmation_message: flags.confirm || undefined,
      }),
      flags.pretty
    )
    return
  }

  if (command === "fill") {
    const refOrSelector = rest[0]
    const text = rest.slice(1).join(" ")
    if (!refOrSelector) throw new Error("ref or selector required")
    print(
      await postAction("fill", {
        ref_or_selector: refOrSelector,
        text,
      }),
      flags.pretty
    )
    return
  }

  if (command === "get") {
    const target = rest[0]
    if (target === "url") {
      print(await postAction("get-url", {}), flags.pretty)
      return
    }
    if (target === "title") {
      print(await postAction("get-title", {}), flags.pretty)
      return
    }
    throw new Error("get target must be url or title")
  }

  if (command === "get-url" || command === "get-title") {
    print(await postAction(command, {}), flags.pretty)
    return
  }

  if (command === "extract-text" || command === "screenshot") {
    print(await postAction(command, {}), flags.pretty)
    return
  }

  throw new Error(`unknown command: ${command}`)
}

run(process.argv.slice(2)).catch((error) => {
  print({ ok: false, error: error.message, code: "CLI_USAGE_ERROR" })
})

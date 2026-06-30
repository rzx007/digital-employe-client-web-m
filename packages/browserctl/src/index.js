#!/usr/bin/env node

import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const VERSION = "0.1.0"
const DEFAULT_BASE_URL =
  process.env.BROWSER_RUNTIME_BRIDGE_URL || "http://127.0.0.1:34555"
let activeBaseUrl = DEFAULT_BASE_URL
// 会话归属：显式 BROWSER_RUNTIME_SESSION 覆盖 > 发起会话 CONVERSATION_ID（桌面端
// 每会话 shell 已注入）> "default"（脱离桌面端单独调 CLI 时回落）。bridge 据此把
// 浏览器面板只摊给发起会话，不再无条件拍到当前前台窗口。
export function resolveSession(env = process.env) {
  const explicit = (env.BROWSER_RUNTIME_SESSION || "").trim()
  if (explicit) return explicit
  const conv = (env.CONVERSATION_ID || "").trim()
  if (conv) return conv
  return "default"
}
// 单次请求 socket 超时；默认 60s 以容纳慢导航，可用 env 覆盖
const REQUEST_TIMEOUT_MS =
  Number(process.env.BROWSER_RUNTIME_TIMEOUT_MS) || 60000

function usage() {
  return `browserctl ${VERSION}

Usage:
  browserctl health [--pretty]
  browserctl open <url> [--pretty]
  browserctl navigate <url> [--pretty]
  browserctl open-artifact <virtual-path>   # 打开会话产物目录里的 HTML 到内嵌浏览器
  browserctl snapshot [--max-nodes 200] [--tree | --interactive] [--pretty]
  browserctl click <@eN|selector> [--confirm "message"] [--pretty]
  browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta] [--pretty]
  browserctl scroll [@eN|selector] [--to top|bottom] [--by <px>] [--pretty]
  browserctl wait (--selector <css> | --text <text> | --ms <n>) [--timeout 10000] [--pretty]
  browserctl fill <@eN|selector> (<text> | --text-file <path> | --text-stdin) [--pretty]
  browserctl select <@eN|selector> (<value> | --label <text>) [--pretty]
  browserctl get url|title [--pretty]
  browserctl get value <@eN|selector> [--pretty]
  browserctl get attr <@eN|selector> <name> [--pretty]
  browserctl get-url [--pretty]
  browserctl get-title [--pretty]
  browserctl extract-text [--pretty]
  browserctl screenshot [--out <path>] [--pretty]
  browserctl close [--pretty]

Environment:
  BROWSER_RUNTIME_BRIDGE_URL  default ${DEFAULT_BASE_URL}
  BROWSER_RUNTIME_SESSION     default ${resolveSession()}`
}

export function parseFlags(argv) {
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
    } else if (value === "--text-file") {
      flags.textFile = argv[++i] || ""
    } else if (value === "--text-stdin") {
      flags.textStdin = true
    } else if (value === "--selector") {
      flags.selector = argv[++i] || ""
    } else if (value === "--text") {
      flags.text = argv[++i] || ""
    } else if (value === "--label") {
      flags.label = argv[++i] || ""
    } else if (value === "--ms") {
      flags.ms = Number(argv[++i])
    } else if (value === "--timeout") {
      flags.timeout = Number(argv[++i])
    } else if (value === "--out") {
      flags.out = argv[++i] || ""
    } else if (value === "--to") {
      flags.to = argv[++i] || ""
    } else if (value === "--by") {
      flags.by = Number(argv[++i])
    } else if (value === "--tree") {
      flags.tree = true
    } else if (value === "--ctrl") {
      flags.ctrl = true
    } else if (value === "--shift") {
      flags.shift = true
    } else if (value === "--alt") {
      flags.alt = true
    } else if (value === "--meta") {
      flags.meta = true
    } else if (value === "--interactive" || value === "-i") {
      flags.interactive = true
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

export function normalizeUrl(input) {
  const value = String(input || "").trim()
  if (!value) return value
  // 已带任意协议（http/https/file/data/...）的 URL 原样返回，
  // 只对裸域名/路径补 https://（之前只放行 http(s)，会把 file:// 误加前缀破坏）。
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
  return `https://${value}`
}

// 把 open-artifact 的输入解析为**真实磁盘绝对路径**（去虚拟前缀后，agent 直接给真实路径）。
// - 真实绝对路径（Windows 盘符 C:/ 或 C:\、Unix /...）→ 原样返回（后端按会话根沙箱校验）。
// - 纯文件名 / 相对路径 → 拼 $ARTIFACTS_DIR（agent 常在产物目录 cwd 下给文件名）。
// 返回 null 表示无法解析（纯文件名但 ARTIFACTS_DIR 未注入）。
export function resolveArtifactRealPath(input) {
  const p = String(input || "").trim()
  if (!p) return null
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(p)
  const isUnixAbs = p.startsWith("/")
  if (isWinAbs || isUnixAbs) return p
  const dir = process.env.ARTIFACTS_DIR
  if (!dir) return null
  return `${dir.replace(/[\\/]+$/, "")}/${p.replace(/^\.?[\\/]/, "")}`
}

function bridgeUrl(path) {
  return new URL(path, activeBaseUrl.replace(/\/$/, ""))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
])

// 把 snapshot 的 refs 数组渲染为紧凑文本，省去 JSON 键名/backendNodeId，降 token：
// - interactiveOnly=false：按 depth 缩进的树
// - interactiveOnly=true：仅保留可交互角色，平铺
export function formatSnapshotText(refs, interactiveOnly) {
  const rows = interactiveOnly
    ? refs.filter((r) => INTERACTIVE_ROLES.has(r.role))
    : refs
  return rows
    .map((r) => {
      const indent = interactiveOnly
        ? ""
        : "  ".repeat(Math.min(r.depth ?? 0, 8))
      const name = r.name ? ` "${r.name}"` : ""
      const value = r.value ? ` = ${JSON.stringify(r.value)}` : ""
      return `${indent}${r.ref} ${r.role}${name}${value}`
    })
    .join("\n")
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = []
    process.stdin.on("data", (chunk) => chunks.push(chunk))
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    )
    process.stdin.on("error", reject)
  })
}

// fill 文本来源优先级：--text-file > --text-stdin > 位置参数
// file/stdin 用于规避命令行特殊字符 quoting；去掉单个尾随换行（echo/编辑器常见）
async function resolveFillText(rest, flags) {
  if (typeof flags.textFile === "string" && flags.textFile) {
    let raw
    try {
      raw = fs.readFileSync(flags.textFile, "utf8")
    } catch (error) {
      throw new Error(`cannot read --text-file ${flags.textFile}: ${error.message}`)
    }
    return raw.replace(/\r?\n$/, "")
  }
  if (flags.textStdin) {
    const raw = await readStdin()
    return raw.replace(/\r?\n$/, "")
  }
  return rest.slice(1).join(" ")
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
    let timedOut = false
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      timedOut = true
      req.destroy()
    })
    req.on("error", (error) => {
      resolve({
        ok: false,
        error: timedOut
          ? `browser runtime request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `cannot connect browser runtime at ${activeBaseUrl}: ${error.message}`,
        code: timedOut ? "BRIDGE_TIMEOUT" : "BRIDGE_CONNECT_FAILED",
      })
    })
    if (body) req.write(body)
    req.end()
  })
}

function postAction(action, payload) {
  return requestJson(
    "POST",
    `/internal/browser/${encodeURIComponent(resolveSession())}/${action}`,
    payload
  )
}

function print(result, pretty = false) {
  const output = pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result)
  process.stdout.write(`${output}\n`)
  process.exitCode = result && result.ok === false ? 1 : 0
}

async function run(argv, baseUrl) {
  if (baseUrl) activeBaseUrl = baseUrl
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

  if (command === "open-artifact") {
    const rawPath = rest[0]
    if (!rawPath) throw new Error("path required")
    const conversationId = process.env.CONVERSATION_ID
    if (!conversationId) {
      print(
        {
          ok: false,
          error:
            "CONVERSATION_ID env not set; cannot resolve which conversation's artifacts to open",
          code: "MISSING_CONVERSATION_ID",
        },
        flags.pretty
      )
      return
    }
    const realPath = resolveArtifactRealPath(rawPath)
    if (!realPath) {
      print(
        {
          ok: false,
          error:
            "cannot resolve path: pass an absolute disk path, or a bare filename with $ARTIFACTS_DIR set",
          code: "CANNOT_RESOLVE_PATH",
        },
        flags.pretty
      )
      return
    }
    const backendBase = (
      process.env.BROWSER_RUNTIME_BACKEND_URL || "http://127.0.0.1:34567"
    ).replace(/\/$/, "")
    // 后端静态服务按真实路径 + 会话根沙箱校验（路径在会话根外时返回 404）
    const url = `${backendBase}/chat/conversations/${conversationId}/resources/static?path=${encodeURIComponent(
      realPath
    )}`
    print(await postAction("navigate", { url }), flags.pretty)
    return
  }

  if (command === "snapshot") {
    const result = await postAction("snapshot", {
      max_nodes: Number.isFinite(flags.maxNodes) ? flags.maxNodes : 200,
    })
    if (
      (flags.tree || flags.interactive) &&
      result.ok &&
      result.data &&
      Array.isArray(result.data.refs)
    ) {
      process.stdout.write(
        `${formatSnapshotText(result.data.refs, Boolean(flags.interactive))}\n`
      )
      return
    }
    print(result, flags.pretty)
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
    if (!refOrSelector) throw new Error("ref or selector required")
    const text = await resolveFillText(rest, flags)
    print(
      await postAction("fill", {
        ref_or_selector: refOrSelector,
        text,
      }),
      flags.pretty
    )
    return
  }

  if (command === "select") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const value = rest[1]
    print(
      await postAction("select", {
        ref_or_selector: refOrSelector,
        value,
        label: flags.label,
      }),
      flags.pretty
    )
    return
  }

  if (command === "press") {
    const key = rest[0]
    if (!key) throw new Error("key required")
    const refOrSelector = rest[1]
    const modifiers = {}
    if (flags.ctrl) modifiers.ctrl = true
    if (flags.shift) modifiers.shift = true
    if (flags.alt) modifiers.alt = true
    if (flags.meta) modifiers.meta = true
    print(
      await postAction("press", { key, ref_or_selector: refOrSelector, modifiers }),
      flags.pretty
    )
    return
  }

  if (command === "scroll") {
    const refOrSelector =
      rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined
    print(
      await postAction("scroll", {
        ref_or_selector: refOrSelector,
        to: flags.to,
        by: Number.isFinite(flags.by) ? flags.by : undefined,
      }),
      flags.pretty
    )
    return
  }

  if (command === "wait") {
    // --ms：纯客户端固定等待，不经 bridge
    if (Number.isFinite(flags.ms)) {
      await sleep(Math.max(0, flags.ms))
      print({ ok: true, data: { waitedMs: flags.ms } }, flags.pretty)
      return
    }
    if (!flags.selector && !flags.text) {
      throw new Error("wait requires --selector, --text or --ms")
    }
    print(
      await postAction("wait", {
        selector: flags.selector,
        text: flags.text,
        timeout_ms: Number.isFinite(flags.timeout) ? flags.timeout : 10000,
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
    if (target === "value") {
      const refOrSelector = rest[1]
      if (!refOrSelector) throw new Error("ref or selector required")
      print(await postAction("get-value", { ref_or_selector: refOrSelector }), flags.pretty)
      return
    }
    if (target === "attr" || target === "attribute") {
      const refOrSelector = rest[1], name = rest[2]
      if (!refOrSelector || !name) throw new Error("ref/selector and attribute name required")
      print(await postAction("get-attribute", { ref_or_selector: refOrSelector, name }), flags.pretty)
      return
    }
    throw new Error("get target must be url|title|value|attr")
  }

  if (command === "get-url" || command === "get-title") {
    print(await postAction(command, {}), flags.pretty)
    return
  }

  if (command === "extract-text") {
    print(await postAction(command, {}), flags.pretty)
    return
  }

  if (command === "close") {
    print(await postAction("close", {}), flags.pretty)
    return
  }

  if (command === "screenshot") {
    // bridge 回 base64（走 HTTP，不入 Agent 上下文）；CLI 落盘到产物目录，只回路径
    const result = await postAction("screenshot", {})
    if (!result.ok) {
      print(result, flags.pretty)
      return
    }
    const base64 = result.data && result.data.base64 ? result.data.base64 : ""
    if (!base64) {
      print(
        { ok: false, error: "empty screenshot data", code: "EMPTY_SCREENSHOT" },
        flags.pretty
      )
      return
    }
    const outPath = flags.out
      ? path.resolve(flags.out)
      : path.resolve(`browser-screenshot-${Date.now()}.png`)
    try {
      fs.writeFileSync(outPath, Buffer.from(base64, "base64"))
    } catch (error) {
      print(
        {
          ok: false,
          error: `cannot write screenshot to ${outPath}: ${error.message}`,
          code: "WRITE_FAILED",
        },
        flags.pretty
      )
      return
    }
    print(
      { ok: true, data: { path: outPath, bytes: fs.statSync(outPath).size } },
      flags.pretty
    )
    return
  }

  throw new Error(`unknown command: ${command}`)
}

export { run }

// 仅当作为可执行入口直接运行时才执行（被测试 import 时不触发）
const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  run(process.argv.slice(2)).catch((error) => {
    print({ ok: false, error: error.message, code: "CLI_USAGE_ERROR" })
  })
}

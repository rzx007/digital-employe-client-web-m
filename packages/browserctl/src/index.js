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
  browserctl snapshot [--max-nodes 200] [--compact|-c] [--depth N|-d N] [--scope <sel>|-s <sel>] [--tree | --interactive] [--pretty]
  browserctl click <@eN|selector> [--confirm "message"] [--pretty]
  browserctl press <key> [@eN|selector] [--ctrl|--shift|--alt|--meta] [--pretty]
  browserctl scroll [@eN|selector] [--to top|bottom] [--by <px>] [--pretty]
  browserctl wait (--selector <css> [--state visible|hidden] | --text <text> | --url <glob> | --load load|domcontentloaded|networkidle | --fn <js> | --fn-file <path> | --fn-stdin | --ms <n>) [--timeout 10000] [--pretty]
  browserctl eval (<js> | --file <path> | --stdin) [--timeout 10000] [--pretty]
  browserctl fill <@eN|selector> (<text> | --text-file <path> | --text-stdin) [--pretty]
  browserctl hover <@eN|selector> [--pretty]
  browserctl dblclick <@eN|selector> [--pretty]
  browserctl focus <@eN|selector> [--pretty]
  browserctl type <@eN|selector> (<text> | --text-file <path> | --text-stdin) [--pretty]
  browserctl check <@eN|selector> [--pretty]
  browserctl uncheck <@eN|selector> [--pretty]
  browserctl drag <@eN|selector> <@eN|selector> [--pretty]
  browserctl upload <@eN|selector> <file...> [--pretty]
  browserctl select <@eN|selector> (<value> | --label <text>) [--pretty]
  browserctl get url|title [--pretty]
  browserctl get value <@eN|selector> [--pretty]
  browserctl get text <@eN|selector> [--pretty]
  browserctl get attr <@eN|selector> <name> [--pretty]
  browserctl is visible|enabled|checked <@eN|selector> [--pretty]
  browserctl find role <role> <action> [value] [--name <accessibleName>] [--exact] [--pretty]
  browserctl find text|label <text> <action> [value] [--exact] [--pretty]
  browserctl find placeholder|testid|alt|title <query> <action> [value] [--pretty]
  browserctl find first|last <selector> <action> [value] [--pretty]
  browserctl find nth <n> <selector> <action> [value] [--pretty]
  browserctl back|forward|reload [--pretty]
  browserctl scrollintoview|scroll-into-view <@eN|selector> [--pretty]
  browserctl dialog status|accept [text]|dismiss [--pretty]
  browserctl batch [--bail] [--json] "<cmd>" "<cmd>" ...   # 顺序执行多条子命令（同进程，仍逐条 HTTP）
  browserctl get-url [--pretty]
  browserctl get-title [--pretty]
  browserctl extract-text [--pretty]
  browserctl screenshot [--annotate] [--out <path>] [--pretty]
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
    } else if (value === "--url") {
      flags.url = argv[++i] || ""
    } else if (value === "--load") {
      flags.load = argv[++i] || ""
    } else if (value === "--fn") {
      flags.fn = argv[++i] || ""
    } else if (value === "--fn-file") {
      flags.fnFile = argv[++i] || ""
    } else if (value === "--fn-stdin") {
      flags.fnStdin = true
    } else if (value === "--state") {
      flags.state = argv[++i] || ""
    } else if (value === "--annotate") {
      flags.annotate = true
    } else if (value === "-c" || value === "--compact") {
      flags.compact = true
    } else if (value === "-d" || value === "--depth") {
      flags.depth = Number(argv[++i])
    } else if (value === "-s" || value === "--scope") {
      flags.scope = argv[++i] || ""
    } else if (value === "--ms") {
      flags.ms = Number(argv[++i])
    } else if (value === "--timeout") {
      flags.timeout = Number(argv[++i])
    } else if (value === "--file") {
      flags.file = argv[++i] || ""
    } else if (value === "--stdin") {
      flags.stdin = true
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
    } else if (value === "--name") {
      flags.name = argv[++i] || ""
    } else if (value === "--exact") {
      flags.exact = true
    } else if (value === "--bail") {
      flags.bail = true
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
      throw new Error(
        `cannot read --text-file ${flags.textFile}: ${error.message}`
      )
    }
    return raw.replace(/\r?\n$/, "")
  }
  if (flags.textStdin) {
    const raw = await readStdin()
    return raw.replace(/\r?\n$/, "")
  }
  return rest.slice(1).join(" ")
}

// eval JS 来源：--file > --stdin > 位置参数
async function resolveJsSource(rest, flags) {
  if (typeof flags.file === "string" && flags.file) {
    try {
      return fs.readFileSync(flags.file, "utf8").replace(/\r?\n$/, "")
    } catch (error) {
      throw new Error(
        `cannot read --file ${flags.file}: ${error.message}`
      )
    }
  }
  if (flags.stdin) {
    return (await readStdin()).replace(/\r?\n$/, "")
  }
  return rest.join(" ")
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
  const output = pretty
    ? JSON.stringify(result, null, 2)
    : JSON.stringify(result)
  process.stdout.write(`${output}\n`)
  process.exitCode = result && result.ok === false ? 1 : 0
}

async function execute(argv, baseUrl, opts = {}) {
  const batchMode = Boolean(opts.batchMode)
  if (baseUrl) activeBaseUrl = baseUrl
  const { args, flags } = parseFlags(argv)
  const [command, ...rest] = args

  if (flags.version) {
    if (!batchMode) process.stdout.write(`${VERSION}\n`)
    return undefined
  }
  if (flags.help || !command) {
    if (!batchMode) process.stdout.write(`${usage()}\n`)
    return undefined
  }

  if (command === "batch") {
    throw new Error("nested batch not allowed")
  }

  if (command === "health") {
    return await requestJson("GET", "/internal/browser/health")
  }

  if (command === "open" || command === "navigate") {
    const url = normalizeUrl(rest[0])
    if (!url) throw new Error("url required")
    return await postAction("navigate", { url })
  }

  if (command === "open-artifact") {
    const rawPath = rest[0]
    if (!rawPath) throw new Error("path required")
    const conversationId = process.env.CONVERSATION_ID
    if (!conversationId) {
      return {
        ok: false,
        error:
          "CONVERSATION_ID env not set; cannot resolve which conversation's artifacts to open",
        code: "MISSING_CONVERSATION_ID",
      }
    }
    const realPath = resolveArtifactRealPath(rawPath)
    if (!realPath) {
      return {
        ok: false,
        error:
          "cannot resolve path: pass an absolute disk path, or a bare filename with $ARTIFACTS_DIR set",
        code: "CANNOT_RESOLVE_PATH",
      }
    }
    const backendBase = (
      process.env.BROWSER_RUNTIME_BACKEND_URL || "http://127.0.0.1:34567"
    ).replace(/\/$/, "")
    const url = `${backendBase}/chat/conversations/${conversationId}/resources/static?path=${encodeURIComponent(
      realPath
    )}`
    return await postAction("navigate", { url })
  }

  if (command === "snapshot") {
    const result = await postAction("snapshot", {
      max_nodes: Number.isFinite(flags.maxNodes) ? flags.maxNodes : 200,
      compact: Boolean(flags.compact),
      max_depth: Number.isFinite(flags.depth) ? flags.depth : undefined,
      scope_selector: flags.scope || undefined,
    })
    if (
      (flags.tree || flags.interactive) &&
      result.ok &&
      result.data &&
      Array.isArray(result.data.refs)
    ) {
      const text = formatSnapshotText(result.data.refs, Boolean(flags.interactive))
      if (batchMode) {
        return { ok: true, data: { format: "text", text } }
      }
      process.stdout.write(`${text}\n`)
      return undefined
    }
    return result
  }

  if (command === "click") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("click", {
      ref_or_selector: refOrSelector,
      confirmation_required: Boolean(flags.confirm),
      confirmation_message: flags.confirm || undefined,
    })
  }

  if (command === "hover") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("hover", { ref_or_selector: refOrSelector })
  }
  if (command === "dblclick") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("dblclick", { ref_or_selector: refOrSelector })
  }
  if (command === "focus") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("focus", { ref_or_selector: refOrSelector })
  }
  if (command === "type") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const text = await resolveFillText(rest, flags)
    return await postAction("type", { ref_or_selector: refOrSelector, text })
  }
  if (command === "check" || command === "uncheck") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction(command, { ref_or_selector: refOrSelector })
  }
  if (command === "drag") {
    const source = rest[0],
      target = rest[1]
    if (!source || !target) throw new Error("source and target required")
    return await postAction("drag", { source, target })
  }
  if (command === "upload") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const files = rest.slice(1)
    if (!files.length) throw new Error("at least one file path required")
    return await postAction("upload", { ref_or_selector: refOrSelector, files })
  }

  if (command === "fill") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const text = await resolveFillText(rest, flags)
    return await postAction("fill", {
      ref_or_selector: refOrSelector,
      text,
    })
  }

  if (command === "select") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    const value = rest[1]
    return await postAction("select", {
      ref_or_selector: refOrSelector,
      value,
      label: flags.label,
    })
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
    return await postAction("press", {
      key,
      ref_or_selector: refOrSelector,
      modifiers,
    })
  }

  if (command === "scroll") {
    const refOrSelector =
      rest[0] && !rest[0].startsWith("--") ? rest[0] : undefined
    return await postAction("scroll", {
      ref_or_selector: refOrSelector,
      to: flags.to,
      by: Number.isFinite(flags.by) ? flags.by : undefined,
    })
  }

  if (command === "eval") {
    const js = await resolveJsSource(rest, flags)
    if (!js) throw new Error("js expression required")
    return await postAction("eval", {
      js,
      timeout_ms: Number.isFinite(flags.timeout) ? flags.timeout : 10_000,
    })
  }

  if (command === "wait") {
    if (Number.isFinite(flags.ms)) {
      await sleep(Math.max(0, flags.ms))
      return { ok: true, data: { waitedMs: flags.ms } }
    }
    if (typeof flags.fnFile === "string" && flags.fnFile) {
      try {
        flags.fn = fs.readFileSync(flags.fnFile, "utf8").replace(/\r?\n$/, "")
      } catch (error) {
        throw new Error(
          `cannot read --fn-file ${flags.fnFile}: ${error.message}`
        )
      }
    } else if (flags.fnStdin) {
      flags.fn = (await readStdin()).replace(/\r?\n$/, "")
    }
    if (flags.state && !flags.selector) {
      throw new Error("--state requires --selector")
    }
    const allowedLoad = new Set(["load", "domcontentloaded", "networkidle"])
    if (flags.load && !allowedLoad.has(flags.load)) {
      throw new Error(
        "--load must be one of load, domcontentloaded, networkidle"
      )
    }
    if (!flags.selector && !flags.text && !flags.url && !flags.load && !flags.fn) {
      throw new Error(
        "wait requires one of --selector, --text, --ms, --url, --load or --fn"
      )
    }
    return await postAction("wait", {
      selector: flags.selector,
      text: flags.text,
      url: flags.url || undefined,
      load: flags.load || undefined,
      fn: flags.fn || undefined,
      state: flags.state || undefined,
      timeout_ms: Number.isFinite(flags.timeout) ? flags.timeout : 10000,
    })
  }

  if (command === "get") {
    const target = rest[0]
    if (target === "url") {
      return await postAction("get-url", {})
    }
    if (target === "title") {
      return await postAction("get-title", {})
    }
    if (target === "value") {
      const refOrSelector = rest[1]
      if (!refOrSelector) throw new Error("ref or selector required")
      return await postAction("get-value", { ref_or_selector: refOrSelector })
    }
    if (target === "text") {
      const refOrSelector = rest[1]
      if (!refOrSelector) throw new Error("ref or selector required")
      return await postAction("get-text", { ref_or_selector: refOrSelector })
    }
    if (target === "attr" || target === "attribute") {
      const refOrSelector = rest[1],
        name = rest[2]
      if (!refOrSelector || !name)
        throw new Error("ref/selector and attribute name required")
      return await postAction("get-attribute", {
        ref_or_selector: refOrSelector,
        name,
      })
    }
    throw new Error("get target must be url|title|value|text|attr")
  }

  if (command === "is") {
    const kind = rest[0]
    const refOrSelector = rest[1]
    if (!["visible", "enabled", "checked"].includes(kind)) {
      throw new Error("is kind must be visible|enabled|checked")
    }
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("is", { kind, ref_or_selector: refOrSelector })
  }

  if (command === "find") {
    const FIND_STRATEGIES = [
      "role",
      "text",
      "label",
      "placeholder",
      "alt",
      "title",
      "testid",
      "first",
      "last",
      "nth",
    ]
    const FIND_ACTIONS = [
      "click",
      "fill",
      "type",
      "hover",
      "focus",
      "check",
      "uncheck",
      "text",
    ]
    const strategy = rest[0]
    if (!FIND_STRATEGIES.includes(strategy)) {
      throw new Error(
        `find strategy must be one of: ${FIND_STRATEGIES.join("|")}`
      )
    }
    let query
    let action
    let valueRest
    let nth
    if (strategy === "nth") {
      nth = Number(rest[1])
      if (!Number.isFinite(nth) || nth < 1) {
        throw new Error("find nth requires 1-based positive integer")
      }
      query = rest[2]
      action = rest[3]
      valueRest = rest.slice(4)
    } else {
      query = rest[1]
      action = rest[2]
      valueRest = rest.slice(3)
    }
    if (!query) throw new Error("find query required")
    if (!FIND_ACTIONS.includes(action)) {
      throw new Error(`find action must be one of: ${FIND_ACTIONS.join("|")}`)
    }
    const needsValue = action === "fill" || action === "type"
    const value = needsValue
      ? await resolveFillText(["_", ...valueRest], flags)
      : undefined
    if (needsValue && !value) {
      throw new Error(`${action} requires value, --text-file, or --text-stdin`)
    }
    return await postAction("find", {
      strategy,
      query,
      action,
      value,
      name: flags.name,
      exact: Boolean(flags.exact),
      nth,
    })
  }

  if (command === "back" || command === "forward" || command === "reload") {
    return await postAction(command, {})
  }

  if (command === "scrollintoview" || command === "scroll-into-view") {
    const refOrSelector = rest[0]
    if (!refOrSelector) throw new Error("ref or selector required")
    return await postAction("scrollintoview", {
      ref_or_selector: refOrSelector,
    })
  }

  if (command === "dialog") {
    const sub = rest[0]
    if (sub === "status") {
      return await postAction("dialog-status", {})
    }
    if (sub === "accept") {
      return await postAction("dialog-accept", {
        prompt_text: rest.slice(1).join(" ") || undefined,
      })
    }
    if (sub === "dismiss") {
      return await postAction("dialog-dismiss", {})
    }
    throw new Error("dialog subcommand must be status|accept|dismiss")
  }

  if (command === "get-url" || command === "get-title") {
    return await postAction(command, {})
  }

  if (command === "extract-text") {
    return await postAction(command, {})
  }

  if (command === "close") {
    return await postAction("close", {})
  }

  if (command === "screenshot") {
    const result = await postAction("screenshot", {
      annotate: Boolean(flags.annotate),
    })
    if (!result.ok) {
      return result
    }
    const base64 = result.data && result.data.base64 ? result.data.base64 : ""
    if (!base64) {
      return {
        ok: false,
        error: "empty screenshot data",
        code: "EMPTY_SCREENSHOT",
      }
    }
    const outPath = flags.out
      ? path.resolve(flags.out)
      : path.resolve(`browser-screenshot-${Date.now()}.png`)
    try {
      fs.writeFileSync(outPath, Buffer.from(base64, "base64"))
    } catch (error) {
      return {
        ok: false,
        error: `cannot write screenshot to ${outPath}: ${error.message}`,
        code: "WRITE_FAILED",
      }
    }
    return {
      ok: true,
      data: {
        path: outPath,
        bytes: fs.statSync(outPath).size,
        annotations: result.data.annotations || [],
      },
    }
  }

  throw new Error(`unknown command: ${command}`)
}

function splitBatchLine(line) {
  const argv = []
  const re = /"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|[^\s]+/g
  let m
  while ((m = re.exec(line)) !== null) {
    let token = m[0]
    if (
      (token.startsWith('"') && token.endsWith('"')) ||
      (token.startsWith("'") && token.endsWith("'"))
    ) {
      token = token.slice(1, -1)
    }
    argv.push(token)
  }
  return argv
}

async function run(argv, baseUrl) {
  const { args, flags } = parseFlags(argv)
  const [command, ...rest] = args

  if (command === "batch") {
    if (rest.some((line) => String(line).trim().startsWith("batch"))) {
      throw new Error("nested batch not allowed")
    }
    const commands = flags.json
      ? JSON.parse(await readStdin())
      : rest
    const results = []
    for (let i = 0; i < commands.length; i++) {
      const item = commands[i]
      const subArgv = Array.isArray(item) ? item : splitBatchLine(String(item))
      if (subArgv[0] === "batch") throw new Error("nested batch not allowed")
      let result
      try {
        result = await execute(subArgv, baseUrl, { batchMode: true })
      } catch (e) {
        result = { ok: false, error: e.message, code: "CLI_USAGE_ERROR" }
      }
      results.push(result ?? { ok: true })
      if (flags.bail && result && result.ok === false) {
        print({ ok: false, data: { failedAt: i, results } }, flags.pretty)
        return
      }
    }
    const allOk = results.every((r) => r && r.ok !== false)
    print({ ok: allOk, data: { results } }, flags.pretty)
    return
  }

  try {
    const result = await execute(argv, baseUrl)
    if (result !== undefined) print(result, flags.pretty)
  } catch (error) {
    print({ ok: false, error: error.message, code: "CLI_USAGE_ERROR" })
  }
}

export { run, execute }

// 仅当作为可执行入口直接运行时才执行（被测试 import 时不触发）
// __CLI_BUNDLE__ 由 browserctl-cli 的 tsup build 注入，打包时跳过此自调用——
// 入口改由 cli.ts 顶层 await run() 负责，避免双次调用。
const invokedDirectly =
  typeof __CLI_BUNDLE__ === "undefined" &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  run(process.argv.slice(2)).catch((error) => {
    print({ ok: false, error: error.message, code: "CLI_USAGE_ERROR" })
  })
}

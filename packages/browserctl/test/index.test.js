import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import {
  parseFlags,
  normalizeUrl,
  formatSnapshotText,
  resolveArtifactRealPath,
  resolveSession,
} from "../src/index.js"

const CLI = fileURLToPath(new URL("../src/index.js", import.meta.url))

// ---- 纯函数 ----

test("parseFlags 区分带值 flag、布尔 flag 与位置参数", () => {
  const { args, flags } = parseFlags([
    "fill",
    "@e1",
    "--text-file",
    "/x.txt",
    "--pretty",
  ])
  assert.deepEqual(args, ["fill", "@e1"])
  assert.equal(flags.textFile, "/x.txt")
  assert.equal(flags.pretty, true)
})

test("parseFlags 支持 --interactive 与 -i 等价", () => {
  assert.equal(parseFlags(["snapshot", "--interactive"]).flags.interactive, true)
  assert.equal(parseFlags(["snapshot", "-i"]).flags.interactive, true)
  assert.equal(parseFlags(["snapshot", "--tree"]).flags.tree, true)
})

test("normalizeUrl 补 https、保留已有协议、空值原样", () => {
  assert.equal(normalizeUrl("baidu.com"), "https://baidu.com")
  assert.equal(normalizeUrl("http://x.com"), "http://x.com")
  assert.equal(normalizeUrl("HTTPS://x.com"), "HTTPS://x.com")
  // 回归：带协议的 URL 原样返回，不被加 https:// 破坏（file:// 曾被坑）
  assert.equal(
    normalizeUrl("file:///C:/Users/x/a.html"),
    "file:///C:/Users/x/a.html"
  )
  assert.equal(normalizeUrl(""), "")
})

test("resolveArtifactRealPath: 真实绝对路径原样，纯文件名拼 ARTIFACTS_DIR", () => {
  // Windows 盘符（正斜杠 / 反斜杠）原样
  assert.equal(resolveArtifactRealPath("C:/x/y/a.html"), "C:/x/y/a.html")
  assert.equal(resolveArtifactRealPath("C:\\x\\y\\a.html"), "C:\\x\\y\\a.html")
  // Unix 绝对路径原样
  assert.equal(resolveArtifactRealPath("/home/u/a.html"), "/home/u/a.html")
  // 纯文件名 / 相对 → 拼 ARTIFACTS_DIR
  const prev = process.env.ARTIFACTS_DIR
  process.env.ARTIFACTS_DIR = "/tmp/art"
  assert.equal(resolveArtifactRealPath("snake.html"), "/tmp/art/snake.html")
  assert.equal(resolveArtifactRealPath("./snake.html"), "/tmp/art/snake.html")
  // 无 ARTIFACTS_DIR 时纯文件名无法解析 → null
  delete process.env.ARTIFACTS_DIR
  assert.equal(resolveArtifactRealPath("snake.html"), null)
  if (prev !== undefined) process.env.ARTIFACTS_DIR = prev
})

test("resolveSession: 显式 SESSION 优先，其次 CONVERSATION_ID，否则 default", () => {
  assert.equal(
    resolveSession({ BROWSER_RUNTIME_SESSION: "abc", CONVERSATION_ID: "42" }),
    "abc"
  )
  assert.equal(resolveSession({ CONVERSATION_ID: "42" }), "42")
  assert.equal(resolveSession({ CONVERSATION_ID: "" }), "default")
  assert.equal(resolveSession({}), "default")
})

test("open-artifact 接受真实绝对路径并拼 ?path= 查询参数 URL", async () => {
  let body
  const srv = await startServer(async (req, res) => {
    body = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  const real =
    "C:/Users/ruanz/.digital-employee/conversations/430/artifacts/fa.html"
  try {
    await runCli(["open-artifact", real], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "430",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
      },
    })
    assert.equal(
      body.url,
      `http://127.0.0.1:34567/chat/conversations/430/resources/static?path=${encodeURIComponent(
        real
      )}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 纯文件名但无 ARTIFACTS_DIR → CANNOT_RESOLVE_PATH 且不发请求", async () => {
  let hit = false
  const srv = await startServer((req, res) => {
    hit = true
    res.end(JSON.stringify({ ok: true }))
  })
  try {
    const { stdout } = await runCli(["open-artifact", "fa.html"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "469",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
        ARTIFACTS_DIR: "",
      },
    })
    const j = JSON.parse(stdout)
    assert.equal(j.ok, false)
    assert.equal(j.code, "CANNOT_RESOLVE_PATH")
    assert.equal(hit, false)
  } finally {
    await closeServer(srv)
  }
})

test("formatSnapshotText tree 模式按 depth 缩进并渲染 value", () => {
  const refs = [
    { ref: "@e0", role: "RootWebArea", name: "标题", value: null, depth: 0 },
    { ref: "@e1", role: "textbox", name: "搜索", value: "x", depth: 2 },
  ]
  assert.equal(
    formatSnapshotText(refs, false),
    '@e0 RootWebArea "标题"\n    @e1 textbox "搜索" = "x"'
  )
})

test("formatSnapshotText interactive 模式仅保留可交互角色且平铺", () => {
  const refs = [
    { ref: "@e0", role: "RootWebArea", name: "t", depth: 0 },
    { ref: "@e1", role: "button", name: "提交", depth: 3 },
    { ref: "@e2", role: "generic", name: null, depth: 1 },
  ]
  assert.equal(formatSnapshotText(refs, true), '@e1 button "提交"')
})

// ---- 集成（mock bridge + 真实子进程）----

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, "127.0.0.1", () => resolve(srv))
  })
}

function closeServer(srv) {
  srv.closeAllConnections?.()
  return new Promise((resolve) => srv.close(resolve))
}

function urlOf(srv) {
  return `http://127.0.0.1:${srv.address().port}`
}

function runCli(args, { env = {}, input } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [CLI, ...args],
      { env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        resolve({ code: err ? (err.code ?? 1) : 0, stdout, stderr })
      }
    )
    if (input != null) {
      child.stdin.write(input)
      child.stdin.end()
    }
  })
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => resolve(b))
  })
}

test("fill --text-file 携带特殊字符原样送达且去掉尾随换行", async () => {
  let received
  const srv = await startServer(async (req, res) => {
    received = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  const tmp = path.join(os.tmpdir(), `browserctl-fill-${process.pid}.txt`)
  fs.writeFileSync(tmp, 'a&b|c "d" 数字 员工\n')
  try {
    await runCli(["fill", "@e1", "--text-file", tmp], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    assert.equal(received.ref_or_selector, "@e1")
    assert.equal(received.text, 'a&b|c "d" 数字 员工')
  } finally {
    fs.unlinkSync(tmp)
    await closeServer(srv)
  }
})

test("fill --text-stdin 从管道读取文本", async () => {
  let received
  const srv = await startServer(async (req, res) => {
    received = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["fill", "@e2", "--text-stdin"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
      input: "管道 x&y",
    })
    assert.equal(received.text, "管道 x&y")
  } finally {
    await closeServer(srv)
  }
})

test("wait --ms 为纯客户端等待，不访问 bridge", async () => {
  const { stdout } = await runCli(["wait", "--ms", "10"], {
    env: { BROWSER_RUNTIME_BRIDGE_URL: "http://127.0.0.1:1" },
  })
  const j = JSON.parse(stdout)
  assert.equal(j.ok, true)
  assert.equal(j.data.waitedMs, 10)
})

test("wait --selector 发送正确 payload 与默认 timeout", async () => {
  let received
  const srv = await startServer(async (req, res) => {
    received = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: { matched: true } }))
  })
  try {
    await runCli(["wait", "--selector", "#content_left"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    assert.equal(received.selector, "#content_left")
    assert.equal(received.timeout_ms, 10000)
  } finally {
    await closeServer(srv)
  }
})

test("snapshot --interactive 输出紧凑文本", async () => {
  const refs = [
    { ref: "@e0", role: "RootWebArea", name: "百度", depth: 0 },
    { ref: "@e1", role: "textbox", name: "搜索", value: "数字员工", depth: 2 },
    { ref: "@e2", role: "button", name: "百度一下", depth: 2 },
  ]
  const srv = await startServer((req, res) =>
    res.end(JSON.stringify({ ok: true, data: { refs } }))
  )
  try {
    const { stdout } = await runCli(["snapshot", "--interactive"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    assert.equal(
      stdout.trim(),
      '@e1 textbox "搜索" = "数字员工"\n@e2 button "百度一下"'
    )
  } finally {
    await closeServer(srv)
  }
})

test("screenshot 落盘并返回路径，stdout 不含 base64", async () => {
  const B =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
  const srv = await startServer((req, res) =>
    res.end(JSON.stringify({ ok: true, data: { base64: B } }))
  )
  const out = path.join(os.tmpdir(), `browserctl-shot-${process.pid}.png`)
  try {
    const { stdout } = await runCli(["screenshot", "--out", out], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    const j = JSON.parse(stdout)
    assert.equal(j.ok, true)
    assert.equal(j.data.path, path.resolve(out))
    assert.ok(!stdout.includes("iVBOR"), "stdout 不应包含 base64")
    const buf = fs.readFileSync(out)
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47])
  } finally {
    if (fs.existsSync(out)) fs.unlinkSync(out)
    await closeServer(srv)
  }
})

test("bridge 接受连接但不响应时返回 BRIDGE_TIMEOUT", async () => {
  const srv = await startServer(() => {
    /* 故意不响应 */
  })
  try {
    const { stdout } = await runCli(["health"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        BROWSER_RUNTIME_TIMEOUT_MS: "300",
      },
    })
    const j = JSON.parse(stdout)
    assert.equal(j.ok, false)
    assert.equal(j.code, "BRIDGE_TIMEOUT")
  } finally {
    await closeServer(srv)
  }
})

test("连不上 bridge 返回 BRIDGE_CONNECT_FAILED", async () => {
  const { stdout } = await runCli(["health"], {
    env: { BROWSER_RUNTIME_BRIDGE_URL: "http://127.0.0.1:1" },
  })
  const j = JSON.parse(stdout)
  assert.equal(j.ok, false)
  assert.equal(j.code, "BRIDGE_CONNECT_FAILED")
})

test("close 命中 close action", async () => {
  let reqUrl
  const srv = await startServer((req, res) => {
    reqUrl = req.url
    res.end(JSON.stringify({ ok: true, data: { closed: true } }))
  })
  try {
    const { stdout } = await runCli(["close"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    assert.ok(reqUrl.endsWith("/close"))
    const j = JSON.parse(stdout)
    assert.equal(j.ok, true)
    assert.equal(j.data.closed, true)
  } finally {
    await closeServer(srv)
  }
})

test("navigate 把 CONVERSATION_ID 作为 bridge 路径 session 段", async () => {
  let reqUrl
  const srv = await startServer((req, res) => {
    reqUrl = req.url
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open", "example.com"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv), CONVERSATION_ID: "77" },
    })
    assert.ok(
      reqUrl.startsWith("/internal/browser/77/navigate"),
      `expected session segment 77, got ${reqUrl}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("navigate 无 CONVERSATION_ID 时回落 default session 段", async () => {
  let reqUrl
  const srv = await startServer((req, res) => {
    reqUrl = req.url
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open", "example.com"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "",
        BROWSER_RUNTIME_SESSION: "",
      },
    })
    assert.ok(
      reqUrl.startsWith("/internal/browser/default/navigate"),
      `expected default segment, got ${reqUrl}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 用 CONVERSATION_ID 与 backend url 构造静态 url 并 navigate", async () => {
  let reqUrl
  let received
  const srv = await startServer(async (req, res) => {
    reqUrl = req.url
    received = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  const real = "/Users/u/.digital-employee/conversations/42/artifacts/report.html"
  try {
    await runCli(["open-artifact", real], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "42",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
      },
    })
    assert.ok(reqUrl.endsWith("/navigate"))
    assert.equal(
      received.url,
      `http://127.0.0.1:34567/chat/conversations/42/resources/static?path=${encodeURIComponent(
        real
      )}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 纯文件名用 ARTIFACTS_DIR 拼真实路径", async () => {
  let received
  const srv = await startServer(async (req, res) => {
    received = JSON.parse(await readBody(req))
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    await runCli(["open-artifact", "a.html"], {
      env: {
        BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv),
        CONVERSATION_ID: "1",
        BROWSER_RUNTIME_BACKEND_URL: "http://127.0.0.1:34567",
        ARTIFACTS_DIR: "/tmp/conv1/artifacts",
      },
    })
    assert.equal(
      received.url,
      `http://127.0.0.1:34567/chat/conversations/1/resources/static?path=${encodeURIComponent(
        "/tmp/conv1/artifacts/a.html"
      )}`
    )
  } finally {
    await closeServer(srv)
  }
})

test("open-artifact 缺少 CONVERSATION_ID 时报错且不访问 bridge", async () => {
  let hit = false
  const srv = await startServer((req, res) => {
    hit = true
    res.end(JSON.stringify({ ok: true, data: {} }))
  })
  try {
    const { stdout } = await runCli(["open-artifact", "/artifacts/a.html"], {
      env: { BROWSER_RUNTIME_BRIDGE_URL: urlOf(srv) },
    })
    const j = JSON.parse(stdout)
    assert.equal(j.ok, false)
    assert.equal(j.code, "MISSING_CONVERSATION_ID")
    assert.equal(hit, false)
  } finally {
    await closeServer(srv)
  }
})

import { describe, expect, it } from "vitest"

import {
  HTML_PREVIEW_SANDBOX,
  rewriteExternalFetchToProxy,
  wrapHtmlForPreview,
} from "./html-preview-utils"

describe("HTML_PREVIEW_SANDBOX", () => {
  // 根因：srcDoc iframe 带 allow-same-origin 时，HTML 内的相对引用（如 dashboard_part1.html）
  // 会解析到 app dev origin（localhost:3399），命中 Vite SPA 回退 → 整个 app 在 iframe 内重挂 →
  // 无限递归 → ERR_INSUFFICIENT_RESOURCES + 后端崩。去掉 allow-same-origin 让 iframe 取得不透明
  // 源，相对 URL 无法再加载 app origin，从结构上杜绝递归。
  it("does not grant same-origin (prevents relative-URL recursion into the SPA)", () => {
    expect(HTML_PREVIEW_SANDBOX).not.toContain("allow-same-origin")
  })

  // 去掉 allow-popups：否则 HTML 内 window.open(相对URL) 会被主窗口 setWindowOpenHandler
  // 拦成 http: → 打开内置浏览器 → 同样落到 SPA 回退。
  it("does not grant popups (prevents window.open escaping to the in-app browser)", () => {
    expect(HTML_PREVIEW_SANDBOX).not.toContain("allow-popups")
  })

  it("still allows scripts (live dashboards run JS / fetch)", () => {
    expect(HTML_PREVIEW_SANDBOX).toContain("allow-scripts")
  })
})

describe("wrapHtmlForPreview", () => {
  it("injects a neutral <base href> into fragments so stray relative refs cannot hit the app origin", () => {
    const wrapped = wrapHtmlForPreview("<div>hi</div>")
    expect(wrapped).toContain('<base href="about:blank"')
  })

  it("wraps bare fragments into a full document", () => {
    const wrapped = wrapHtmlForPreview("<p>hello</p>")
    expect(wrapped).toContain("<!DOCTYPE html>")
    expect(wrapped).toContain("<p>hello</p>")
  })

  // 关键回归：总管看板多是完整文档，其相对引用必须被中性 base 中和，否则递归崩溃。
  it("injects a neutral <base href> into FULL documents (the curator dashboard case)", () => {
    const full =
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><iframe src="dashboard_part1.html"></iframe></body></html>'
    const wrapped = wrapHtmlForPreview(full)
    expect(wrapped).toContain('<base href="about:blank"')
    // base 必须出现在相对引用之前，才能左右其解析
    expect(wrapped.indexOf('<base href="about:blank"')).toBeLessThan(
      wrapped.indexOf("dashboard_part1.html")
    )
    // 原内容保留
    expect(wrapped).toContain('<iframe src="dashboard_part1.html">')
  })

  it("base is placed at the very start of <head> (precedes any in-doc base/asset)", () => {
    const full =
      '<html><head><link rel="stylesheet" href="x.css"></head><body>x</body></html>'
    const wrapped = wrapHtmlForPreview(full)
    expect(wrapped.indexOf('<base href="about:blank"')).toBeLessThan(
      wrapped.indexOf("x.css")
    )
  })

  it("handles full documents that have <html> but no <head>", () => {
    const full = "<html><body><a href='part1.html'>x</a></body></html>"
    const wrapped = wrapHtmlForPreview(full)
    expect(wrapped).toContain('<base href="about:blank"')
    expect(wrapped.indexOf('<base href="about:blank"')).toBeLessThan(
      wrapped.indexOf("part1.html")
    )
  })
})

describe("rewriteExternalFetchToProxy", () => {
  const BASE = "http://localhost:34567"

  it("rewrites a double-quoted external fetch to the backend proxy", () => {
    const out = rewriteExternalFetchToProxy(
      `fetch("https://uapis.cn/api?type=weibo")`,
      BASE
    )
    expect(out).toBe(
      `fetch("http://localhost:34567/proxy?url=${encodeURIComponent(
        "https://uapis.cn/api?type=weibo"
      )}")`
    )
  })

  it("handles single quotes and backticks (no interpolation)", () => {
    expect(rewriteExternalFetchToProxy(`fetch('http://x.com/a')`, BASE)).toContain(
      "/proxy?url=" + encodeURIComponent("http://x.com/a")
    )
    expect(
      rewriteExternalFetchToProxy("fetch(`https://x.com/b`)", BASE)
    ).toContain("/proxy?url=" + encodeURIComponent("https://x.com/b"))
  })

  it("rewrites multiple fetches in one document", () => {
    const html =
      `fetch("https://a.com/1"); later fetch('https://b.com/2')`
    const out = rewriteExternalFetchToProxy(html, BASE)
    expect(out).toContain(encodeURIComponent("https://a.com/1"))
    expect(out).toContain(encodeURIComponent("https://b.com/2"))
  })

  it("does NOT rewrite template literals with ${} interpolation", () => {
    const html = "fetch(`https://x.com/${id}/data`)"
    expect(rewriteExternalFetchToProxy(html, BASE)).toBe(html)
  })

  it("does NOT rewrite relative or non-http fetches", () => {
    const html = `fetch("/local/api"); fetch("data:text/plain,hi")`
    expect(rewriteExternalFetchToProxy(html, BASE)).toBe(html)
  })

  it("does NOT double-proxy requests already pointing at the backend", () => {
    const html = `fetch("http://localhost:34567/proxy?url=x")`
    expect(rewriteExternalFetchToProxy(html, BASE)).toBe(html)
  })

  it("returns html unchanged when no proxy base is provided", () => {
    const html = `fetch("https://x.com/a")`
    expect(rewriteExternalFetchToProxy(html, "")).toBe(html)
  })
})

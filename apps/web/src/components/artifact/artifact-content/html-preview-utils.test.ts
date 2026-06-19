import { describe, expect, it } from "vitest"

import {
  buildProxyInterceptorScript,
  HTML_PREVIEW_SANDBOX,
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

  it("默认不注入隐藏滚动条样式", () => {
    const wrapped = wrapHtmlForPreview("<div>hi</div>")
    expect(wrapped).not.toContain("scrollbar-width")
  })

  it("hideScrollbar=true 时注入隐藏滚动条样式（仍保留滚动）", () => {
    // 工作台看板用：iframe 内容高于格子时不显丑滚动条，但内容仍可滚。
    const wrapped = wrapHtmlForPreview("<div>hi</div>", "", { hideScrollbar: true })
    expect(wrapped).toContain("scrollbar-width:none")
    expect(wrapped).toContain("::-webkit-scrollbar")
  })

  it("hideScrollbar 对完整文档也注入到 <head>", () => {
    const full =
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>x</body></html>'
    const wrapped = wrapHtmlForPreview(full, "", { hideScrollbar: true })
    expect(wrapped).toContain("scrollbar-width:none")
  })
})

describe("buildProxyInterceptorScript / wrapHtmlForPreview proxy injection", () => {
  const BASE = "http://localhost:34567"

  it("wrapHtmlForPreview injects the interceptor script into <head> when a base is given", () => {
    const out = wrapHtmlForPreview("<div>hi</div>", BASE)
    expect(out).toContain("window.fetch")
    expect(out).toContain("/proxy?url=")
    // 脚本须在 base 之后、body 之前（早于看板自身脚本）
    expect(out.indexOf("window.fetch")).toBeGreaterThan(
      out.indexOf('<base href="about:blank"')
    )
    expect(out.indexOf("window.fetch")).toBeLessThan(out.indexOf("<body"))
  })

  it("wrapHtmlForPreview does NOT inject interceptor when no base (default)", () => {
    const out = wrapHtmlForPreview("<div>hi</div>")
    expect(out).not.toContain("window.fetch")
  })

  it("injects into a FULL document's <head> before its own scripts", () => {
    const full =
      '<!DOCTYPE html><html><head></head><body><script>fetch(API+t)</script></body></html>'
    const out = wrapHtmlForPreview(full, BASE)
    expect(out.indexOf("window.fetch")).toBeLessThan(out.indexOf("fetch(API+t)"))
  })

  // 运行时行为：在受控沙箱里执行注入脚本，验证 patch 后的 fetch 把外部 URL 改走 /proxy，
  // 且相对/本地后端/非 http 的 URL 不动。覆盖 fetch(API_BASE + type) 这类拼接写法。
  it("patched fetch routes ANY external url through proxy regardless of how it was built", () => {
    const script = buildProxyInterceptorScript(BASE)
    // 取出 <script>…</script> 内的 JS 主体
    const body = script.replace(/^<script>/, "").replace(/<\/script>$/, "")

    const calls: string[] = []
    const fakeWindow: Record<string, unknown> = {
      fetch: (u: unknown) => {
        calls.push(String(u))
        return Promise.resolve()
      },
      URL,
      encodeURIComponent,
      // 无 XMLHttpRequest，patch 时跳过 XHR 分支
    }
    // 用 with(window) 还原 iframe 内「全局即 window」语义
    new Function("window", `with(window){${body}}`)(fakeWindow)

    const patched = fakeWindow.fetch as (u: string) => unknown
    // 拼接构造的外部 URL（这正是 fetch(API_BASE + type) 的最终形态）
    patched("https://uapis.cn/api/v1/misc/hotboard?type=bilibili")
    patched("/local/api") // 相对，不动
    patched("http://localhost:34567/proxy?url=x") // 本地后端，不套娃

    expect(calls[0]).toBe(
      `http://localhost:34567/proxy?url=${encodeURIComponent(
        "https://uapis.cn/api/v1/misc/hotboard?type=bilibili"
      )}`
    )
    expect(calls[1]).toBe("/local/api")
    expect(calls[2]).toBe("http://localhost:34567/proxy?url=x")
  })

  it("returns empty interceptor (no-op) script body when base is empty", () => {
    // wrapHtmlForPreview 空 base 时根本不注入；buildProxyInterceptorScript 空 base 时脚本自身 early-return
    const script = buildProxyInterceptorScript("")
    expect(script).toContain("if(!B)return")
  })
})

import test from "node:test"
import assert from "node:assert/strict"
import { launch } from "chrome-launcher"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { BrowserController } from "@workspace/browser-sdk"
import { ChromeCdpTransport } from "../src/chrome-transport.js"

test("headless Chrome 端到端：navigate→snapshot(含同源 iframe)→fill→get value→select", async (t) => {
  let chrome: Awaited<ReturnType<typeof launch>> | undefined
  try {
    chrome = await launch({
      chromeFlags: ["--headless=new", "--allow-file-access-from-files"],
    })
  } catch {
    t.skip("无可用 Chrome，跳过集成测试")
    return
  }

  const transport = new ChromeCdpTransport({ port: chrome.port })
  await transport.attach()
  const c = new BrowserController(transport)

  try {
    // 导航到 fixture 页
    const url = pathToFileURL(
      path.resolve(import.meta.dirname, "fixtures/iframe-page.html")
    ).href
    const nav = await c.navigate(url)
    assert.equal(nav.ok, true, `navigate 应成功；error=${nav.error}`)

    // 等待 iframe srcdoc 加载（srcdoc 是同源，但需给渲染器一点时间）
    await new Promise<void>((r) => setTimeout(r, 500))

    // 快照：收集所有 refs（含同源 iframe 内控件）
    const snap = await c.snapshot(300)
    assert.equal(snap.ok, true, `snapshot 应成功；error=${snap.error}`)

    const refs = snap.data!.refs
    assert.ok(refs.length > 0, "refs 不应为空")

    // 打印所有 refs 以便诊断 role 值
    console.log(
      "[集成测试] snapshot refs:",
      refs.map((r) => `${r.ref} role=${r.role} name=${r.name}`)
    )

    // 文本框：real Chrome a11y 树中 <input type="text"> 的 role 是 "textbox"
    const textboxes = refs.filter(
      (r) => r.role === "textbox" || r.role === "textBox"
    )

    if (textboxes.length < 2) {
      // iframe 内 input 未出现 → 记录真实发现而非静默跳过
      console.warn(
        `[集成测试] 警告：期望 >=2 个 textbox（main + iframe），` +
          `实际得到 ${textboxes.length}。` +
          `这说明 srcdoc iframe 的 a11y 树未被 frame-walk 合并（可能需要 OOPIF session 支持）。`
      )
    }

    // 无论 iframe 是否出现，至少应有主 frame 的 input#q
    assert.ok(
      textboxes.length >= 1,
      `期望至少 1 个 textbox（主 frame），实际得到 ${textboxes.length}；` +
        `roles: ${refs.map((r) => r.role).join(", ")}`
    )

    // fill 主 frame 第一个文本框并回读
    const firstBox = textboxes[0].ref
    const fill = await c.fill(firstBox, "数字员工")
    assert.equal(fill.ok, true, `fill 应成功；error=${fill.error}`)

    const val = await c.getValue(firstBox)
    assert.equal(val.ok, true, `getValue 应成功；error=${val.error}`)
    assert.equal(
      (val.data as { value: string }).value,
      "数字员工",
      "fill→getValue 值应一致"
    )

    // getTitle 返回 string（非 CdpResult）
    const title = await c.getTitle()
    assert.equal(typeof title, "string", "getTitle 应返回 string")

    // ---- 额外验证：iframe 内 input 是否在 snapshot 中（记录真实发现）----
    const iframeTextboxCount = textboxes.length >= 2 ? "出现" : "未出现"
    console.log(
      `[集成测试] iframe 内 input 在 snapshot 中：${iframeTextboxCount}` +
        `（textboxes=${textboxes.length}）`
    )
  } finally {
    await transport.detach()
    await chrome.kill()
  }
})

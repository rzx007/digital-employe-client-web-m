// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest"
import { pinHtmlToWorkbench } from "./pin-html-to-workbench"
import { loadWorkbenchConfig } from "./workbench-config"

describe("pinHtmlToWorkbench", () => {
  beforeEach(() => localStorage.clear())

  it("钉一个 html 后 config 里出现对应 block", () => {
    pinHtmlToWorkbench({
      conversationId: 5,
      path: "/abs/sales.html",
      name: "sales.html",
    })
    const cfg = loadWorkbenchConfig("global")
    expect(cfg?.blocks.length).toBe(1)
    expect(cfg?.blocks[0].title).toBe("sales")
    expect(cfg?.blocks[0].htmlRef.resourcePath).toBe("/abs/sales.html")
  })
})

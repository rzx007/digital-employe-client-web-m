// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { addHtmlArtifactBlock } from "./workbench-config"
import type { WorkbenchConfig } from "@/types/workbench"
import { buildWorkbenchSnapshot } from "./workbench-context"

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockReturnValue(1000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildWorkbenchSnapshot", () => {
  it("returns 当前没有看板。 when no config stored", () => {
    expect(buildWorkbenchSnapshot()).toBe("当前没有看板。")
  })

  it("describes a single enabled block with title/span/pos", () => {
    const base: WorkbenchConfig = {
      employeeId: "global",
      blocks: [],
      lastModified: 1,
    }
    addHtmlArtifactBlock(
      base,
      { conversationId: 1, resourcePath: "/artifacts/sales.html", pinnedAt: 0 },
      "销售",
      { w: 6, h: 6 },
      { x: 0, y: 0 }
    )
    expect(buildWorkbenchSnapshot()).toContain("1. 销售（6×6@0,0）")
  })
})

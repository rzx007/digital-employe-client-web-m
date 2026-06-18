// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { HtmlArtifactRef, WorkbenchConfig } from "@/types/workbench"
import {
  addHtmlArtifactBlock,
  emitWorkbenchConfigChanged,
  loadWorkbenchConfig,
  removeBlock,
  updateBlockOrder,
  WORKBENCH_CONFIG_CHANGED_EVENT,
} from "./workbench-config"

const KEY = "workbench-config-global"

function makeRef(path: string): HtmlArtifactRef {
  return { conversationId: 12, resourcePath: path, pinnedAt: 1 }
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(Date, "now").mockReturnValue(1000)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("loadWorkbenchConfig", () => {
  it("returns null when nothing stored", () => {
    expect(loadWorkbenchConfig("global")).toBeNull()
  })

  it("resets legacy config (block missing html-artifact type) to null", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        employeeId: "global",
        blocks: [{ id: "x", type: "custom", queryInterface: { id: "i" } }],
        lastModified: 1,
      })
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(loadWorkbenchConfig("global")).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it("loads a valid html-artifact config", () => {
    const cfg: WorkbenchConfig = {
      employeeId: "global",
      blocks: [
        {
          id: "b1",
          type: "html-artifact",
          title: "看板",
          enabled: true,
          order: 0,
          htmlRef: makeRef("/artifacts/a.html"),
        },
      ],
      lastModified: 1,
    }
    localStorage.setItem(KEY, JSON.stringify(cfg))
    expect(loadWorkbenchConfig("global")).toEqual(cfg)
  })
})

describe("addHtmlArtifactBlock", () => {
  it("appends a new html-artifact block and persists", () => {
    const base: WorkbenchConfig = {
      employeeId: "global",
      blocks: [],
      lastModified: 1,
    }
    const next = addHtmlArtifactBlock(base, makeRef("/artifacts/a.html"), "销售看板")
    expect(next.blocks).toHaveLength(1)
    expect(next.blocks[0]).toMatchObject({
      type: "html-artifact",
      title: "销售看板",
      enabled: true,
      order: 0,
      htmlRef: { resourcePath: "/artifacts/a.html" },
    })
    expect(loadWorkbenchConfig("global")?.blocks).toHaveLength(1)
  })

  it("does not duplicate when pinning the same artifact twice; updates title in place", () => {
    let cfg: WorkbenchConfig = {
      employeeId: "global",
      blocks: [],
      lastModified: 1,
    }
    cfg = addHtmlArtifactBlock(cfg, makeRef("/artifacts/a.html"), "旧标题")
    const firstId = cfg.blocks[0]!.id
    cfg = addHtmlArtifactBlock(cfg, makeRef("/artifacts/a.html"), "新标题")
    expect(cfg.blocks).toHaveLength(1)
    expect(cfg.blocks[0]!.id).toBe(firstId)
    expect(cfg.blocks[0]!.title).toBe("新标题")
  })
})

describe("removeBlock / updateBlockOrder", () => {
  it("removes a block and re-orders remaining", () => {
    let cfg: WorkbenchConfig = { employeeId: "global", blocks: [], lastModified: 1 }
    cfg = addHtmlArtifactBlock(cfg, makeRef("/a.html"), "A")
    cfg = addHtmlArtifactBlock(cfg, makeRef("/b.html"), "B")
    const firstId = cfg.blocks[0]!.id
    cfg = removeBlock(cfg, firstId)
    expect(cfg.blocks).toHaveLength(1)
    expect(cfg.blocks[0]!.order).toBe(0)
  })

  it("reorders blocks by id list", () => {
    let cfg: WorkbenchConfig = { employeeId: "global", blocks: [], lastModified: 1 }
    cfg = addHtmlArtifactBlock(cfg, makeRef("/a.html"), "A")
    cfg = addHtmlArtifactBlock(cfg, makeRef("/b.html"), "B")
    const [a, b] = cfg.blocks.map((x) => x.id)
    cfg = updateBlockOrder(cfg, [b!, a!])
    expect(cfg.blocks.map((x) => x.id)).toEqual([b, a])
    expect(cfg.blocks.map((x) => x.order)).toEqual([0, 1])
  })
})

describe("emitWorkbenchConfigChanged", () => {
  it("dispatches the config-changed event on window", () => {
    const handler = vi.fn()
    window.addEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, handler)
    emitWorkbenchConfigChanged()
    expect(handler).toHaveBeenCalledTimes(1)
    window.removeEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, handler)
  })
})

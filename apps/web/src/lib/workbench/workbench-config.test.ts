// @vitest-environment happy-dom
import { describe, it, expect } from "vitest"
import {
  emptyConfig, addHtmlTab, removeTab, reorderTabs, reorderWidgets, removeWidget, resizeWidget,
} from "./workbench-config"

const ref = (p: string) => ({ conversationId: "c1", resourcePath: p, pinnedAt: 1 })

describe("workbench-config v2 纯函数", () => {
  it("钉 HTML 追加 tab 到 tabOrder 末尾并设 active", () => {
    const c = addHtmlTab(emptyConfig(), ref("/a.html"), "A")
    expect(c.htmlTabs).toHaveLength(1)
    expect(c.tabOrder[c.tabOrder.length - 1]).toBe(c.htmlTabs[0].id)
    expect(c.activeTabId).toBe(c.htmlTabs[0].id)
  })
  it("钉重复 HTML 不新增 tab,只切到已存在的", () => {
    const c1 = addHtmlTab(emptyConfig(), ref("/a.html"), "A")
    const c2 = addHtmlTab(c1, ref("/a.html"), "A")
    expect(c2.htmlTabs).toHaveLength(1)
    expect(c2.activeTabId).toBe(c1.htmlTabs[0].id)
  })
  it("关闭当前 tab 回退并从 tabOrder 移除", () => {
    let c = addHtmlTab(emptyConfig(), ref("/a.html"), "A")
    const id = c.htmlTabs[0].id
    c = removeTab(c, id)
    expect(c.htmlTabs).toHaveLength(0)
    expect(c.tabOrder).toEqual(["dashboard"])
    expect(c.activeTabId).toBe("dashboard")
  })
  it("dashboard 标签不可关闭", () => {
    const c = removeTab(emptyConfig(), "dashboard")
    expect(c.tabOrder).toEqual(["dashboard"])
  })
  it("reorderTabs 保持 dashboard 在首位", () => {
    let c = addHtmlTab(emptyConfig(), ref("/a.html"), "A")
    c = reorderTabs(c, [c.htmlTabs[0].id, "dashboard"])
    expect(c.tabOrder[0]).toBe("dashboard")
  })
  it("reorderWidgets 按新顺序重排并刷新 order", () => {
    const base = { ...emptyConfig(), dashboard: { widgets: [
      { id: "w1", type: "kpi", title: "1", order: 0 }, { id: "w2", type: "kpi", title: "2", order: 1 },
    ] } } as any
    const c = reorderWidgets(base, ["w2", "w1"])
    expect(c.dashboard.widgets.map((w: any) => w.id)).toEqual(["w2", "w1"])
    expect(c.dashboard.widgets[0].order).toBe(0)
  })
  it("removeWidget / resizeWidget", () => {
    const base = { ...emptyConfig(), dashboard: { widgets: [{ id: "w1", type: "kpi", title: "1", order: 0 }] } } as any
    expect(removeWidget(base, "w1").dashboard.widgets).toHaveLength(0)
    expect(resizeWidget(base, "w1", 300, 200).dashboard.widgets[0].width).toBe(300)
  })
})

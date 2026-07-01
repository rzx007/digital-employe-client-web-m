// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PieWidget } from "./pie-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const widget: WorkbenchWidget = {
  id: "wp",
  type: "pie",
  title: "流量来源",
  order: 0,
}

describe("PieWidget", () => {
  it("有数据时渲染标题(不崩)", () => {
    render(
      <PieWidget
        widget={widget}
        data={{
          items: [
            { name: "直接访问", value: 38 },
            { name: "搜索引擎", value: 27 },
            { name: "社交媒体", value: 18 },
          ],
        }}
      />
    )
    expect(screen.getByText("流量来源")).toBeTruthy()
  })

  it("无数据时空态", () => {
    render(<PieWidget widget={widget} data={{}} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("过滤掉 value 为 null 的项后若为空则空态", () => {
    render(<PieWidget widget={widget} data={{ items: [{ name: "x", value: null }] }} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })
})

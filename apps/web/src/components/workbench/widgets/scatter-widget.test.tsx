// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ScatterWidget } from "./scatter-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const widget: WorkbenchWidget = {
  id: "wsc",
  type: "kpi",
  title: "价格销量分布",
  order: 0,
}

describe("ScatterWidget", () => {
  it("有数据时渲染标题(不崩)", () => {
    render(
      <ScatterWidget
        widget={widget}
        data={{
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 5 },
            { x: 5, y: 4 },
          ],
          xLabel: "价格",
          yLabel: "销量",
        }}
      />
    )
    expect(screen.getByText("价格销量分布")).toBeTruthy()
  })

  it("无数据时空态", () => {
    render(<ScatterWidget widget={widget} data={{}} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("points 为空数组时空态", () => {
    render(<ScatterWidget widget={widget} data={{ points: [] }} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })
})

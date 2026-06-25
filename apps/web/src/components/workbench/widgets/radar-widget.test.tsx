// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { RadarWidget } from "./radar-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const widget: WorkbenchWidget = {
  id: "wr",
  type: "kpi",
  title: "模型能力雷达",
  order: 0,
}

describe("RadarWidget", () => {
  it("有数据时渲染标题(不崩)", () => {
    render(
      <RadarWidget
        widget={widget}
        data={{
          axisKey: "axis",
          rows: [
            { axis: "速度", A: 80 },
            { axis: "精度", A: 90 },
            { axis: "稳定", A: 70 },
          ],
          series: [{ key: "A", label: "模型A" }],
        }}
      />
    )
    expect(screen.getByText("模型能力雷达")).toBeTruthy()
  })

  it("无数据时空态", () => {
    render(<RadarWidget widget={widget} data={{}} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("series 为空时空态", () => {
    render(
      <RadarWidget
        widget={widget}
        data={{
          rows: [{ axis: "速度", A: 80 }],
          series: [],
        }}
      />
    )
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })
})

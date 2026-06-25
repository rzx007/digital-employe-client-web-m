// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { GaugeWidget } from "./gauge-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const widget: WorkbenchWidget = {
  id: "wg",
  type: "kpi",
  title: "目标完成度",
  order: 0,
}

describe("GaugeWidget", () => {
  it("有数据时渲染标题(不崩)", () => {
    render(
      <GaugeWidget
        widget={widget}
        data={{ value: 72, max: 100, label: "完成度" }}
      />
    )
    expect(screen.getByText("目标完成度")).toBeTruthy()
  })

  it("无数据时空态", () => {
    render(<GaugeWidget widget={widget} data={{}} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("value 为 null 时空态", () => {
    render(<GaugeWidget widget={widget} data={{ value: null }} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })
})

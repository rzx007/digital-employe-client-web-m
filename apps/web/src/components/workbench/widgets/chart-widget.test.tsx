// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ChartWidget } from "./chart-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const baseWidget: WorkbenchWidget = {
  id: "w5",
  type: "line",
  title: "折线图",
  order: 0,
}

describe("ChartWidget", () => {
  it("renders card title", () => {
    const data = {
      rows: [{ month: "Jan", sales: 100 }],
      xKey: "month",
      series: [{ key: "sales", label: "销售额" }],
    }
    render(<ChartWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("折线图")).toBeTruthy()
  })

  it("renders empty state when rows is empty", () => {
    const data = {
      rows: [],
      xKey: "month",
      series: [{ key: "sales", label: "销售额" }],
    }
    render(<ChartWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders gracefully with missing data", () => {
    render(<ChartWidget widget={baseWidget} data={{}} />)
    expect(screen.getByText("折线图")).toBeTruthy()
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders bar chart type", () => {
    const barWidget: WorkbenchWidget = { ...baseWidget, type: "bar", title: "柱状图" }
    const data = {
      rows: [{ x: "Q1", val: 50 }],
      xKey: "x",
      series: [{ key: "val", label: "数值" }],
    }
    render(<ChartWidget widget={barWidget} data={data} />)
    expect(screen.getByText("柱状图")).toBeTruthy()
  })

  it("renders area chart type", () => {
    const areaWidget: WorkbenchWidget = {
      ...baseWidget,
      type: "area",
      title: "面积图",
    }
    const data = {
      rows: [{ x: "Jan", v: 30 }],
      xKey: "x",
      series: [{ key: "v", label: "值" }],
    }
    render(<ChartWidget widget={areaWidget} data={data} />)
    expect(screen.getByText("面积图")).toBeTruthy()
  })
})

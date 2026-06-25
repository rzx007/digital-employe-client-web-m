// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { KpiWidget } from "./kpi-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const baseWidget: WorkbenchWidget = {
  id: "w1",
  type: "kpi",
  title: "KPI 指标",
  order: 0,
}

describe("KpiWidget", () => {
  it("renders items with values", () => {
    const data = {
      items: [
        { label: "销售额", value: 1200, unit: "¥" },
        { label: "订单数", value: 42 },
      ],
    }
    render(<KpiWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("KPI 指标")).toBeTruthy()
    expect(screen.getByText("¥1200")).toBeTruthy()
    expect(screen.getByText("42")).toBeTruthy()
    expect(screen.getByText("销售额")).toBeTruthy()
  })

  it("renders — for null value", () => {
    const data = {
      items: [{ label: "空值", value: null }],
    }
    render(<KpiWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("renders — for undefined value", () => {
    const data = {
      items: [{ label: "未定义", value: undefined }],
    }
    render(<KpiWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("renders delta badge with direction", () => {
    const data = {
      items: [{ label: "增长", value: 100, delta: "+12%", deltaDir: "up" }],
    }
    render(<KpiWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("+12%")).toBeTruthy()
  })

  it("renders empty state gracefully with no items", () => {
    render(<KpiWidget widget={baseWidget} data={{}} />)
    expect(screen.getByText("KPI 指标")).toBeTruthy()
  })
})

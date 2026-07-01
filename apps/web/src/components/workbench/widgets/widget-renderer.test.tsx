// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { WidgetBody } from "./widget-renderer"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

describe("WidgetBody", () => {
  it("renders unsupported type message", () => {
    const widget = {
      id: "w-unknown",
      type: "unknown" as any,
      title: "未知组件",
      order: 0,
    } satisfies WorkbenchWidget
    render(<WidgetBody widget={widget} data={{}} />)
    expect(screen.getByText(/不支持的组件类型/)).toBeTruthy()
    expect(screen.getByText(/unknown/)).toBeTruthy()
  })

  it("renders kpi widget via registry", () => {
    const widget: WorkbenchWidget = {
      id: "w-kpi",
      type: "kpi",
      title: "KPI 测试",
      order: 0,
    }
    const data = {
      items: [{ label: "收入", value: 9999, unit: "$" }],
    }
    render(<WidgetBody widget={widget} data={data} />)
    expect(screen.getByText("KPI 测试")).toBeTruthy()
    expect(screen.getByText("9999")).toBeTruthy()
  })

  it("renders table widget via registry", () => {
    const widget: WorkbenchWidget = {
      id: "w-table",
      type: "table",
      title: "表格测试",
      order: 0,
    }
    const data = {
      columns: [{ key: "name", label: "名称" }],
      rows: [{ name: "Alice" }],
    }
    render(<WidgetBody widget={widget} data={data} />)
    expect(screen.getByText("表格测试")).toBeTruthy()
    expect(screen.getByText("Alice")).toBeTruthy()
  })

  it("renders list widget via registry", () => {
    const widget: WorkbenchWidget = {
      id: "w-list",
      type: "list",
      title: "列表测试",
      order: 0,
    }
    const data = {
      items: [{ title: "条目1", value: "OK" }],
    }
    render(<WidgetBody widget={widget} data={data} />)
    expect(screen.getByText("列表测试")).toBeTruthy()
    expect(screen.getByText("条目1")).toBeTruthy()
  })

  it("renders progress widget via registry", () => {
    const widget: WorkbenchWidget = {
      id: "w-progress",
      type: "progress",
      title: "进度测试",
      order: 0,
    }
    const data = {
      items: [{ label: "完成率", value: 50 }],
    }
    render(<WidgetBody widget={widget} data={data} />)
    expect(screen.getByText("进度测试")).toBeTruthy()
  })
})

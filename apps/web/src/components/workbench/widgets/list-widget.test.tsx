// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ListWidget } from "./list-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const baseWidget: WorkbenchWidget = {
  id: "w3",
  type: "list",
  title: "列表组件",
  order: 0,
}

describe("ListWidget", () => {
  it("renders items with title and value", () => {
    const data = {
      items: [
        { title: "任务A", value: "完成" },
        { title: "任务B", value: "进行中" },
      ],
    }
    render(<ListWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("列表组件")).toBeTruthy()
    expect(screen.getByText("任务A")).toBeTruthy()
    expect(screen.getByText("完成")).toBeTruthy()
    expect(screen.getByText("任务B")).toBeTruthy()
    expect(screen.getByText("进行中")).toBeTruthy()
  })

  it("renders badge when provided", () => {
    const data = {
      items: [{ title: "优先事项", badge: "紧急" }],
    }
    render(<ListWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("紧急")).toBeTruthy()
  })

  it("does not show value when null", () => {
    const data = {
      items: [{ title: "无值", value: null }],
    }
    render(<ListWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("无值")).toBeTruthy()
    // null value should not render
    expect(screen.queryByText("null")).toBeNull()
  })

  it("shows empty state when no items", () => {
    render(<ListWidget widget={baseWidget} data={{ items: [] }} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders gracefully with missing data", () => {
    render(<ListWidget widget={baseWidget} data={{}} />)
    expect(screen.getByText("列表组件")).toBeTruthy()
  })
})

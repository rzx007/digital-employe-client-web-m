// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { ProgressWidget } from "./progress-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const baseWidget: WorkbenchWidget = {
  id: "w4",
  type: "progress",
  title: "进度指标",
  order: 0,
}

describe("ProgressWidget", () => {
  it("renders progress items with label and value", () => {
    const data = {
      items: [
        { label: "完成度", value: 75 },
        { label: "目标达成", value: 60, max: 100 },
      ],
    }
    render(<ProgressWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("进度指标")).toBeTruthy()
    expect(screen.getByText("完成度")).toBeTruthy()
    expect(screen.getByText("目标达成")).toBeTruthy()
    expect(screen.getByText("75%")).toBeTruthy()
    expect(screen.getByText("60 / 100")).toBeTruthy()
  })

  it("shows — for null value", () => {
    const data = {
      items: [{ label: "空进度", value: null }],
    }
    render(<ProgressWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("shows empty state when no items", () => {
    render(<ProgressWidget widget={baseWidget} data={{ items: [] }} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders gracefully with missing data", () => {
    render(<ProgressWidget widget={baseWidget} data={{}} />)
    expect(screen.getByText("进度指标")).toBeTruthy()
  })
})

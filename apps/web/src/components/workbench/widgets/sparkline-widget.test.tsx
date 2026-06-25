// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { SparklineWidget } from "./sparkline-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const widget: WorkbenchWidget = {
  id: "ws",
  type: "kpi",
  title: "本周访问趋势",
  order: 0,
}

describe("SparklineWidget", () => {
  it("有数据时渲染标题(不崩)", () => {
    render(
      <SparklineWidget
        widget={widget}
        data={{
          label: "本周访问",
          value: 1280,
          unit: "",
          delta: "+8%",
          deltaDir: "up",
          points: [5, 7, 6, 9, 8, 11, 12],
        }}
      />
    )
    expect(screen.getByText("本周访问趋势")).toBeTruthy()
  })

  it("无数据时也能渲染(无空态, 显示破折号)", () => {
    render(<SparklineWidget widget={widget} data={{}} />)
    expect(screen.getByText("本周访问趋势")).toBeTruthy()
    expect(screen.getByText("—")).toBeTruthy()
  })
})

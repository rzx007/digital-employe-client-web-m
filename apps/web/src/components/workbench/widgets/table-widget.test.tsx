// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TableWidget } from "./table-widget"
import type { WorkbenchWidget } from "@/types/workbench"

afterEach(() => cleanup())

const baseWidget: WorkbenchWidget = {
  id: "w2",
  type: "table",
  title: "数据表格",
  order: 0,
}

describe("TableWidget", () => {
  it("renders columns and rows", () => {
    const data = {
      columns: [
        { key: "name", label: "姓名" },
        { key: "score", label: "分数" },
      ],
      rows: [
        { name: "张三", score: 95 },
        { name: "李四", score: 80 },
      ],
    }
    render(<TableWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("数据表格")).toBeTruthy()
    expect(screen.getByText("姓名")).toBeTruthy()
    expect(screen.getByText("分数")).toBeTruthy()
    expect(screen.getByText("张三")).toBeTruthy()
    expect(screen.getByText("95")).toBeTruthy()
    expect(screen.getByText("李四")).toBeTruthy()
    expect(screen.getByText("80")).toBeTruthy()
  })

  it("兼容 LLM 形状:字符串列 + 数组行(定位取值)", () => {
    const data = {
      columns: ["日期", "TOP1话题", "热度峰值", "趋势"],
      rows: [
        ["06-22 周一", "欧洲杯小组赛战报", "1350万", "↑"],
        ["06-25 周四", "世界杯16强对阵出炉", "1580万", "↑"],
      ],
    }
    render(
      <TableWidget
        widget={{ ...baseWidget, subtitle: "2026-06-25 更新" }}
        data={data}
      />
    )
    expect(screen.getByText("日期")).toBeTruthy()
    expect(screen.getByText("趋势")).toBeTruthy()
    expect(screen.getByText("欧洲杯小组赛战报")).toBeTruthy()
    expect(screen.getByText("1580万")).toBeTruthy()
    expect(screen.getByText("2026-06-25 更新")).toBeTruthy() // subtitle 渲染
  })

  it("renders — for null cell values", () => {
    const data = {
      columns: [{ key: "val", label: "值" }],
      rows: [{ val: null }],
    }
    render(<TableWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("—")).toBeTruthy()
  })

  it("shows empty state when no rows", () => {
    const data = {
      columns: [{ key: "name", label: "姓名" }],
      rows: [],
    }
    render(<TableWidget widget={baseWidget} data={data} />)
    expect(screen.getByText("暂无数据")).toBeTruthy()
  })

  it("renders gracefully with missing data", () => {
    render(<TableWidget widget={baseWidget} data={{}} />)
    expect(screen.getByText("数据表格")).toBeTruthy()
  })
})

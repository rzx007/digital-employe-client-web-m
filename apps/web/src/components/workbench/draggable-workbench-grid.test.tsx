// @vitest-environment happy-dom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { DraggableWorkbenchGrid } from "./draggable-workbench-grid"
import type { WorkbenchWidget } from "@/types/workbench"

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>
  )
}

const widgets: WorkbenchWidget[] = [
  {
    id: "w1",
    type: "kpi",
    title: "销售",
    order: 0,
    data: { items: [{ label: "本月", value: 5 }] },
  },
]

describe("DraggableWorkbenchGrid", () => {
  it("渲染 widget 标题", () => {
    render(
      <Wrapper>
        <DraggableWorkbenchGrid
          widgets={widgets}
          onReorder={vi.fn()}
          onRemoveWidget={vi.fn()}
          onResizeWidget={vi.fn()}
        />
      </Wrapper>
    )
    expect(screen.getByText("销售")).toBeTruthy()
  })

  it("点删除触发 onRemoveWidget", () => {
    const onRemove = vi.fn()
    render(
      <Wrapper>
        <DraggableWorkbenchGrid
          widgets={widgets}
          onReorder={vi.fn()}
          onRemoveWidget={onRemove}
          onResizeWidget={vi.fn()}
        />
      </Wrapper>
    )
    // dnd-kit duplicates sortable items (live + aria ghost); take the last one
    const btns = screen.getAllByTestId("remove-widget")
    const btn = btns[btns.length - 1]
    fireEvent.click(btn)
    expect(onRemove).toHaveBeenCalledWith("w1")
  })
})

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { ShellExecution } from "@/hooks/use-shell-executions"

// 隔离取数 hook
const useShellExecutions = vi.fn()
vi.mock("@/hooks/use-shell-executions", () => ({
  useShellExecutions: (...args: unknown[]) => useShellExecutions(...args),
}))

// 隔离 store：仅暴露 open / toggle spy
const openSpy = vi.fn()
const toggleSpy = vi.fn()
vi.mock("@/stores/shell-tasks-panel-store", () => ({
  useShellTasksPanelStore: {
    getState: () => ({ open: openSpy, toggle: toggleSpy }),
  },
}))

import { ShellTasksIndicator } from "./shell-tasks-indicator"

function makeExecution(partial: Partial<ShellExecution>): ShellExecution {
  return {
    session_id: "s1",
    command: "ls -la",
    intent: null,
    status: "running",
    running: true,
    exit_code: null,
    started_wall: 1_700_000_000,
    elapsed_seconds: 0,
    ...partial,
  }
}

afterEach(() => {
  cleanup()
  useShellExecutions.mockReset()
  openSpy.mockReset()
  toggleSpy.mockReset()
})

describe("ShellTasksIndicator", () => {
  it("2 条 running → 渲染含「2」的指示条", () => {
    useShellExecutions.mockReturnValue({
      data: [
        makeExecution({ session_id: "a", running: true, status: "running" }),
        makeExecution({ session_id: "b", running: true, status: "running" }),
      ],
    })

    const { container } = render(
      <ShellTasksIndicator conversationId={42} />
    )

    expect(container.firstChild).not.toBeNull()
    expect(screen.getByText(/2 个后台命令/)).toBeTruthy()
  })

  it("count>0 渲染 inline 超链接文案（非居中 pill）", () => {
    useShellExecutions.mockReturnValue({
      data: [
        makeExecution({ session_id: "a", running: true, status: "running" }),
        makeExecution({ session_id: "b", running: true, status: "running" }),
      ],
    })

    render(<ShellTasksIndicator conversationId="1" />)
    const link = screen.getByRole("button")
    expect(link.textContent).toContain("2 个后台命令")
    expect(link.className).not.toContain("rounded-full")
  })

  it("只计 running（finished/killed 不计入）", () => {
    useShellExecutions.mockReturnValue({
      data: [
        makeExecution({ session_id: "a", running: true, status: "running" }),
        makeExecution({
          session_id: "b",
          running: false,
          status: "finished",
          exit_code: 0,
        }),
        makeExecution({
          session_id: "c",
          running: false,
          status: "killed",
          exit_code: null,
        }),
      ],
    })

    render(<ShellTasksIndicator conversationId={42} />)

    expect(screen.getByText(/1 个后台命令/)).toBeTruthy()
  })

  it("0 条 running（全终态）→ 渲染 null，容器为空", () => {
    useShellExecutions.mockReturnValue({
      data: [
        makeExecution({
          session_id: "a",
          running: false,
          status: "finished",
          exit_code: 0,
        }),
        makeExecution({
          session_id: "b",
          running: false,
          status: "killed",
          exit_code: null,
        }),
      ],
    })

    const { container } = render(
      <ShellTasksIndicator conversationId={42} />
    )

    expect(container.firstChild).toBeNull()
  })

  it("无执行记录 → 渲染 null，容器为空", () => {
    useShellExecutions.mockReturnValue({ data: [] })

    const { container } = render(
      <ShellTasksIndicator conversationId={42} />
    )

    expect(container.firstChild).toBeNull()
  })

  it("点击默认调用 store.toggle", () => {
    useShellExecutions.mockReturnValue({
      data: [makeExecution({ session_id: "a", running: true })],
    })

    render(<ShellTasksIndicator conversationId={42} />)
    fireEvent.click(screen.getByRole("button"))

    expect(toggleSpy).toHaveBeenCalledTimes(1)
  })

  it("onOpenShellTasks 优先于 store", () => {
    useShellExecutions.mockReturnValue({
      data: [makeExecution({ session_id: "a", running: true })],
    })
    const onOpen = vi.fn()

    render(
      <ShellTasksIndicator conversationId={42} onOpenShellTasks={onOpen} />
    )
    fireEvent.click(screen.getByRole("button"))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(toggleSpy).not.toHaveBeenCalled()
  })
})

// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import type { TaskExecution } from "@/types/schedule-monitor"

// 隔离取数 hook
const useCuratorTaskExecutions = vi.fn()
vi.mock("@/hooks/use-schedule-monitor-queries", () => ({
  useCuratorTaskExecutions: (...args: unknown[]) =>
    useCuratorTaskExecutions(...args),
}))

// 隔离 store：仅暴露 open spy
const openSpy = vi.fn()
vi.mock("@/stores/employee-tasks-panel-store", () => ({
  useEmployeeTasksPanelStore: {
    getState: () => ({ open: openSpy }),
  },
}))

import { RunningTasksIndicator } from "./running-tasks-indicator"

function makeExecution(partial: Partial<TaskExecution>): TaskExecution {
  return {
    id: 1,
    task_id: 1,
    employee_name: "员工A",
    workspace_id: 1,
    employee_id: 1,
    skill_id: 1,
    conversation_id: 1,
    orchestrator_conversation_id: 1,
    task_name: "任务",
    run_status: "running",
    run_result: null,
    error_message: null,
    input: {},
    output: { content: "" },
    started_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    duration_ms: null,
    skill_rating: null,
    confirm_url: null,
    confirm_execution_result: false,
    result_confirmed: false,
    is_read: false,
    ...partial,
  }
}

afterEach(() => {
  cleanup()
  useCuratorTaskExecutions.mockReset()
  openSpy.mockReset()
})

describe("RunningTasksIndicator", () => {
  it("2 条 running → 渲染含「2」的指示条", () => {
    useCuratorTaskExecutions.mockReturnValue({
      data: [
        makeExecution({ id: 1, run_status: "running" }),
        makeExecution({ id: 2, run_status: "running" }),
      ],
    })

    const { container } = render(
      <RunningTasksIndicator curatorConversationId={42} />
    )

    // 容器不为空
    expect(container.firstChild).not.toBeNull()
    // 含「2」
    expect(screen.getByText(/2 个任务在执行/)).toBeTruthy()
  })

  it("混合状态：running + queued + pending + stuck 全计入", () => {
    useCuratorTaskExecutions.mockReturnValue({
      data: [
        makeExecution({ id: 1, run_status: "running" }),
        makeExecution({ id: 2, run_status: "queued" }),
        makeExecution({ id: 3, run_status: "pending" }),
        makeExecution({ id: 4, run_status: "stuck" }),
      ],
    })

    render(<RunningTasksIndicator curatorConversationId={42} />)

    expect(screen.getByText(/4 个任务在执行/)).toBeTruthy()
  })

  it("0 条 running（全终态）→ 渲染 null，容器为空", () => {
    useCuratorTaskExecutions.mockReturnValue({
      data: [
        makeExecution({ id: 1, run_status: "success" }),
        makeExecution({ id: 2, run_status: "failed" }),
      ],
    })

    const { container } = render(
      <RunningTasksIndicator curatorConversationId={42} />
    )

    expect(container.firstChild).toBeNull()
  })

  it("无执行记录 → 渲染 null，容器为空", () => {
    useCuratorTaskExecutions.mockReturnValue({ data: [] })

    const { container } = render(
      <RunningTasksIndicator curatorConversationId={42} />
    )

    expect(container.firstChild).toBeNull()
  })
})

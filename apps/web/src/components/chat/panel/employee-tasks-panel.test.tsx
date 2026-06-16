// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import type { TaskExecution } from "@/types/schedule-monitor"

// 隔离取数 hook：直接喂固定执行记录，避免网络 / QueryClient。
const useCuratorTaskExecutions = vi.fn()
vi.mock("@/hooks/use-schedule-monitor-queries", () => ({
  useCuratorTaskExecutions: (...args: unknown[]) =>
    useCuratorTaskExecutions(...args),
}))

// ExecutionReportCard 依赖 useMutation / 导航等重副作用，测试只关心面板分区编排，
// 用轻量桩替代：渲染任务名 + 状态，便于断言每区一条且含任务名。
vi.mock("@/components/chat/message-blocks/execution-report-card", () => ({
  ExecutionReportCard: ({ execution }: { execution: TaskExecution }) => (
    <div data-testid="exec-card" data-status={execution.run_status}>
      {execution.task_name}
    </div>
  ),
}))

import { EmployeeTasksPanel } from "./employee-tasks-panel"

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
})

describe("EmployeeTasksPanel", () => {
  it("按状态分进行中 / 已完成两区，各一条且含任务名", () => {
    useCuratorTaskExecutions.mockReturnValue({
      data: [
        makeExecution({
          id: 10,
          run_status: "running",
          task_name: "采集行业数据",
        }),
        makeExecution({
          id: 11,
          run_status: "success",
          task_name: "生成周报",
          ended_at: "2026-01-01T00:05:00Z",
          duration_ms: 300000,
        }),
      ],
      isPending: false,
    })

    render(
      <EmployeeTasksPanel
        curatorConversationId={1}
        curatorContactId="curator-1"
        onClose={() => {}}
      />
    )

    // 两个分区标题各一条计数
    expect(screen.getByText("进行中 · 1")).toBeTruthy()
    expect(screen.getByText("已完成 · 1")).toBeTruthy()

    // 各区任务名都渲染出来
    expect(screen.getByText("采集行业数据")).toBeTruthy()
    expect(screen.getByText("生成周报")).toBeTruthy()

    const cards = screen.getAllByTestId("exec-card")
    expect(cards).toHaveLength(2)
    expect(cards.map((c) => c.getAttribute("data-status")).sort()).toEqual([
      "running",
      "success",
    ])
  })

  it("无执行记录时显示空态提示", () => {
    useCuratorTaskExecutions.mockReturnValue({ data: [], isPending: false })

    render(<EmployeeTasksPanel curatorConversationId={1} onClose={() => {}} />)

    expect(screen.getByText("暂无员工任务")).toBeTruthy()
  })
})

// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

// live 事件通道 mock 成 no-op(测 seed/对账路径,不触发 SSE)
vi.mock("@/hooks/use-workspace-events", () => ({
  useWorkspaceEvents: () => {},
}))

// 受控的执行状态(DB 真值)
const execData = vi.fn<() => Array<{ task_id: number; run_status: string }>>()
vi.mock("@/hooks/use-schedule-monitor-queries", () => ({
  useCuratorTaskExecutions: () => ({ data: execData() }),
}))

import { usePlanProgress } from "./use-plan-progress"

describe("usePlanProgress 用执行状态 seed/对账(修复漏事件卡 pending)", () => {
  it("没收到 live 事件的任务,从 DB 执行状态补成 success(不再卡待执行)", () => {
    execData.mockReturnValue([{ task_id: 1, run_status: "success" }])
    const { result } = renderHook(() => usePlanProgress([1, 2], "conv1"))
    expect(result.current.statusByTaskId[1]).toBe("success")
    expect(result.current.statusByTaskId[2]).toBe("pending")
    expect(result.current.completed).toBe(1)
    expect(result.current.total).toBe(2)
  })

  it("running 执行 → running,不计入 completed", () => {
    execData.mockReturnValue([{ task_id: 1, run_status: "running" }])
    const { result } = renderHook(() => usePlanProgress([1], "conv1"))
    expect(result.current.statusByTaskId[1]).toBe("running")
    expect(result.current.completed).toBe(0)
  })

  it("失败类状态(timeout/cancelled/failed)→ failed,计入 completed", () => {
    execData.mockReturnValue([{ task_id: 1, run_status: "timeout" }])
    const { result } = renderHook(() => usePlanProgress([1], "conv1"))
    expect(result.current.statusByTaskId[1]).toBe("failed")
    expect(result.current.completed).toBe(1)
  })
})

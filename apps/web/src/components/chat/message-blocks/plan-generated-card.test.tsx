// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

// mount 适配：组件在渲染期就调用这些 hook（useQueryClient 无 Provider 会抛、
// usePlanProgress 内部连 SSE/EventSource 在 happy-dom 下易脆），全部 mock 掉以隔离
// 自身渲染分支。usePlanProgress 仍返回 total=2/completed=0，让未改动的组件按现状
// 渲染出进度条的「执行中 0/2」——这正是本测应失败锁定的目标行为。
vi.mock("@/hooks/use-chat-queries", () => ({
  useOrchestrationPlansQuery: () => ({
    data: [{ id: 99, status: "executing" }],
  }),
}))
vi.mock("@/components/chat/curator/curator-plan-feedback-context", () => ({
  useCuratorPlanFeedback: () => null,
}))
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))
vi.mock("@/hooks/use-plan-progress", () => ({
  usePlanProgress: () => ({ statusByTaskId: {}, completed: 0, total: 2 }),
}))

import { PlanGeneratedCard } from "./plan-generated-card"

const RESULT = JSON.stringify({
  type: "plan_generated",
  plan_id: 99,
  summary: "并行查询",
  tasks: [
    { task_id: 1, task_name: "查微博热搜", employee_name: "微博助手" },
    { task_id: 2, task_name: "查小米价格", employee_name: "浏览器助手" },
  ],
})

describe("PlanGeneratedCard（已确认态）", () => {
  it("渲染静态提示、不渲染进度条的「执行中 N/M」", () => {
    render(
      <PlanGeneratedCard
        input={{ summary: "并行查询" }}
        state="output-available"
        resultText={RESULT}
        conversationId={1}
        isTurnEnded
      />
    )
    expect(screen.getByText(/进度见右侧/)).toBeTruthy()
    expect(screen.queryByText(/0\/2/)).toBeNull()
  })
})

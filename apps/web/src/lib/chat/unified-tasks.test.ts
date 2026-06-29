import { describe, expect, it } from "vitest"

import type { ShellExecution } from "@/hooks/use-shell-executions"
import type { SubtaskCardItem } from "@/stores/tasks-panel-store"
import type { TaskExecution } from "@/types/schedule-monitor"

import {
  countRunning,
  mergeUnifiedTasks,
  normalizeEmployee,
  normalizeShell,
  normalizeSubtask,
} from "./unified-tasks"

function subtask(over: Partial<SubtaskCardItem> = {}): SubtaskCardItem {
  return {
    toolCallId: "t1",
    description: "调研竞品",
    subagentType: "researcher",
    state: "input-available",
    preliminary: false,
    output: null,
    firstSeenAt: 1000,
    ...over,
  }
}

function shell(over: Partial<ShellExecution> = {}): ShellExecution {
  return {
    session_id: "s1",
    command: "npm run build",
    intent: null,
    status: "running",
    running: true,
    exit_code: null,
    started_wall: 2,
    elapsed_seconds: 5,
    ...over,
  }
}

function employee(over: Partial<TaskExecution> = {}): TaskExecution {
  return {
    id: 1,
    task_id: 1,
    employee_name: "小李",
    workspace_id: 1,
    employee_id: 1,
    skill_id: 1,
    conversation_id: 1,
    task_name: "整理周报",
    run_status: "running",
    run_result: null,
    error_message: null,
    input: {},
    output: { content: "" },
    started_at: "2026-06-29T00:00:03.000Z",
    ended_at: null,
    duration_ms: null,
    skill_rating: null,
    confirm_url: null,
    confirm_execution_result: false,
    result_confirmed: false,
    is_read: false,
    ...over,
  }
}

describe("normalizeSubtask", () => {
  it("maps output-error → failed, finished output → success, otherwise running", () => {
    expect(normalizeSubtask(subtask({ state: "output-error" })).status).toBe(
      "failed"
    )
    expect(
      normalizeSubtask(
        subtask({ state: "output-available", preliminary: false })
      ).status
    ).toBe("success")
    expect(
      normalizeSubtask(
        subtask({ state: "output-available", preliminary: true })
      ).running
    ).toBe(true)
  })

  it("falls back sortAt to 0 when firstSeenAt missing", () => {
    expect(normalizeSubtask(subtask({ firstSeenAt: undefined })).sortAt).toBe(0)
  })
})

describe("normalizeShell", () => {
  it("running stays running; killed → killed; non-zero exit → failed", () => {
    expect(normalizeShell(shell()).status).toBe("running")
    expect(
      normalizeShell(shell({ running: false, status: "killed" })).status
    ).toBe("killed")
    expect(
      normalizeShell(
        shell({ running: false, status: "finished", exit_code: 1 })
      ).status
    ).toBe("failed")
    expect(
      normalizeShell(
        shell({ running: false, status: "finished", exit_code: 0 })
      ).status
    ).toBe("success")
  })

  it("converts started_wall (epoch seconds) to ms", () => {
    expect(normalizeShell(shell({ started_wall: 2 })).sortAt).toBe(2000)
  })
})

describe("normalizeEmployee", () => {
  it("collapses cancelled/superseded → killed and queued/pending → queued", () => {
    expect(normalizeEmployee(employee({ run_status: "cancelled" })).status).toBe(
      "killed"
    )
    expect(
      normalizeEmployee(employee({ run_status: "superseded" })).status
    ).toBe("killed")
    expect(normalizeEmployee(employee({ run_status: "queued" })).status).toBe(
      "queued"
    )
    expect(normalizeEmployee(employee({ run_status: "timeout" })).status).toBe(
      "timeout"
    )
  })

  it("treats running/queued/pending/stuck as running for grouping", () => {
    expect(normalizeEmployee(employee({ run_status: "running" })).running).toBe(
      true
    )
    expect(normalizeEmployee(employee({ run_status: "stuck" })).running).toBe(
      true
    )
    expect(normalizeEmployee(employee({ run_status: "success" })).running).toBe(
      false
    )
  })
})

describe("mergeUnifiedTasks", () => {
  it("merges three sources sorted by time descending (newest first)", () => {
    const merged = mergeUnifiedTasks({
      subtasks: [subtask({ firstSeenAt: 1000 })], // 1000ms
      shells: [shell({ started_wall: 2 })], // 2000ms
      employees: [employee()], // 2026-... → large
    })
    expect(merged.map((i) => i.kind)).toEqual(["employee", "shell", "subtask"])
  })

  it("countRunning counts only running items across kinds", () => {
    const merged = mergeUnifiedTasks({
      subtasks: [subtask({ state: "output-available", preliminary: false })],
      shells: [shell({ running: true })],
      employees: [employee({ run_status: "running" })],
    })
    expect(countRunning(merged)).toBe(2)
  })
})

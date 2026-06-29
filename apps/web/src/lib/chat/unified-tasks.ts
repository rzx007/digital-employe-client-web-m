import type { ShellExecution } from "@/hooks/use-shell-executions"
import type { SubtaskCardItem } from "@/stores/tasks-panel-store"
import {
  ACTIVE_TASK_RUN_STATUSES,
  type TaskExecution,
} from "@/types/schedule-monitor"

/** 合并任务面板里的三类任务来源。 */
export type TaskKind = "subtask" | "shell" | "employee"

/**
 * 合并面板的细粒度状态：顶层只分「进行中 / 已完成」两组（由 running 切分），
 * 但卡片徽章用此细粒度状态，让「失败 / 已终止 / 超时」在已完成组里仍一眼可辨。
 */
export type UnifiedTaskStatus =
  | "running"
  | "success"
  | "failed"
  | "killed"
  | "timeout"
  | "queued"

/** 三类任务归一后的统一视图项；原始数据挂在对应字段上，供展开详情按类型渲染。 */
export interface UnifiedTaskItem {
  /** kind + 原始主键，去重 / React key 稳定键 */
  key: string
  kind: TaskKind
  /** 是否进行中（顶层分组依据） */
  running: boolean
  status: UnifiedTaskStatus
  /** 排序用时间戳（ms，越大越新） */
  sortAt: number
  subtask?: SubtaskCardItem
  shell?: ShellExecution
  employee?: TaskExecution
}

function subtaskStatus(item: SubtaskCardItem): UnifiedTaskStatus {
  if (item.state === "output-error") return "failed"
  if (item.state === "output-available" && !item.preliminary) return "success"
  return "running"
}

export function normalizeSubtask(item: SubtaskCardItem): UnifiedTaskItem {
  const status = subtaskStatus(item)
  return {
    key: `subtask:${item.toolCallId}`,
    kind: "subtask",
    running: status === "running",
    status,
    sortAt: item.firstSeenAt ?? 0,
    subtask: item,
  }
}

function shellStatus(exec: ShellExecution): UnifiedTaskStatus {
  if (exec.running) return "running"
  if (exec.status === "killed") return "killed"
  return exec.exit_code === 0 ? "success" : "failed"
}

export function normalizeShell(exec: ShellExecution): UnifiedTaskItem {
  return {
    key: `shell:${exec.session_id}`,
    kind: "shell",
    running: exec.running,
    status: shellStatus(exec),
    // started_wall 是 epoch 秒，统一换成 ms。
    sortAt: exec.started_wall * 1000,
    shell: exec,
  }
}

function employeeStatus(exec: TaskExecution): UnifiedTaskStatus {
  switch (exec.run_status) {
    case "success":
      return "success"
    case "failed":
      return "failed"
    case "timeout":
      return "timeout"
    case "cancelled":
    case "superseded":
      return "killed"
    case "queued":
    case "pending":
      return "queued"
    default:
      // running / stuck → 进行中
      return "running"
  }
}

export function normalizeEmployee(exec: TaskExecution): UnifiedTaskItem {
  return {
    key: `employee:${exec.id}`,
    kind: "employee",
    running: ACTIVE_TASK_RUN_STATUSES.has(exec.run_status),
    status: employeeStatus(exec),
    sortAt: Date.parse(exec.started_at) || 0,
    employee: exec,
  }
}

/**
 * 把三类来源归一并按时间倒序合并成单一列表（最新在前）。
 * 顶层「进行中 / 已完成」分组由调用方按 item.running 切分。
 */
export function mergeUnifiedTasks(input: {
  subtasks: SubtaskCardItem[]
  shells: ShellExecution[]
  employees: TaskExecution[]
}): UnifiedTaskItem[] {
  return [
    ...input.subtasks.map(normalizeSubtask),
    ...input.shells.map(normalizeShell),
    ...input.employees.map(normalizeEmployee),
  ].sort((a, b) => b.sortAt - a.sortAt)
}

/** 合并列表里进行中任务数（统一入口角标 / 内联指示器共用）。 */
export function countRunning(items: UnifiedTaskItem[]): number {
  return items.reduce((n, i) => (i.running ? n + 1 : n), 0)
}

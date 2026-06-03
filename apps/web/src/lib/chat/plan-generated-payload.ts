import type { ToolUiActionOutbound } from "./tool-ui-action"

export interface PlanTaskPreview {
  task_id?: number
  employee_id?: number
  employee_name?: string
  task_name: string
  cron?: string | null
  execute_mode?: string
}

export interface PlanGeneratedOutput {
  type: "plan_generated"
  plan_id: number
  summary?: string
  total_tasks?: number
  requires_confirmation?: boolean
  tasks?: PlanTaskPreview[]
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isPlanTaskPreview(value: unknown): value is PlanTaskPreview {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as PlanTaskPreview).task_name === "string"
  )
}

export function parsePlanGeneratedOutput(
  resultText: string | null | undefined
): PlanGeneratedOutput | null {
  if (!resultText?.trim()) return null
  const firstLine = resultText.trim().split("\n", 1)[0] ?? ""
  const obj = parseJsonObject(firstLine)
  if (!obj || obj.type !== "plan_generated") return null
  const planId = obj.plan_id
  if (typeof planId !== "number" || !Number.isFinite(planId)) return null
  const tasksRaw = obj.tasks
  const tasks = Array.isArray(tasksRaw)
    ? tasksRaw.filter(isPlanTaskPreview)
    : undefined
  return {
    type: "plan_generated",
    plan_id: planId,
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    total_tasks:
      typeof obj.total_tasks === "number" ? obj.total_tasks : undefined,
    requires_confirmation:
      typeof obj.requires_confirmation === "boolean"
        ? obj.requires_confirmation
        : undefined,
    tasks: tasks?.length ? tasks : undefined,
  }
}

export function planRequiresManualConfirmation(
  output: PlanGeneratedOutput | null | undefined
): boolean {
  return output != null
}

/** 总管 Agent 指令：卡片已确认计划（勿再调 confirm_orchestration_plan） */
export function buildPlanManualConfirmAgentFeedback(
  planId: number,
  summary?: string
) {
  const label = summary ? `（${summary}）` : ""
  return (
    `【手动操作】我已在卡片上确认执行编排计划 #${planId}${label}，` +
    "请知晓，无需再调用 confirm_orchestration_plan。"
  )
}

/** @deprecated 使用 buildPlanManualConfirmAgentFeedback */
export const buildPlanManualConfirmFeedback = buildPlanManualConfirmAgentFeedback

export function buildPlanManualConfirmDisplayText(
  planId: number,
  summary?: string
) {
  const s = summary?.trim()
  return s
    ? `已确认执行编排计划「${s}」`
    : `已确认执行编排计划 #${planId}`
}

export function buildPlanManualConfirmOutbound(
  planId: number,
  summary?: string
): ToolUiActionOutbound {
  return {
    agentText: buildPlanManualConfirmAgentFeedback(planId, summary),
    displayText: buildPlanManualConfirmDisplayText(planId, summary),
    uiAction: "plan_confirm",
  }
}

/** 总管 Agent 指令：卡片已取消计划 */
export function buildPlanManualCancelAgentFeedback(
  planId: number,
  summary?: string
) {
  const label = summary ? `（${summary}）` : ""
  return (
    `【手动操作】我已在卡片上取消编排计划 #${planId}${label}，` +
    "请知晓，无需再调用 cancel_plan。"
  )
}

/** @deprecated 使用 buildPlanManualCancelAgentFeedback */
export const buildPlanManualCancelFeedback = buildPlanManualCancelAgentFeedback

export function buildPlanManualCancelDisplayText(
  planId: number,
  summary?: string
) {
  const s = summary?.trim()
  return s ? `已取消编排计划「${s}」` : `已取消编排计划 #${planId}`
}

export function buildPlanManualCancelOutbound(
  planId: number,
  summary?: string
): ToolUiActionOutbound {
  return {
    agentText: buildPlanManualCancelAgentFeedback(planId, summary),
    displayText: buildPlanManualCancelDisplayText(planId, summary),
    uiAction: "plan_cancel",
  }
}

export function parsePlanTasksFromOutput(
  resultText: string | null | undefined
): PlanTaskPreview[] {
  const output = parsePlanGeneratedOutput(resultText)
  return output?.tasks ?? []
}

export function resolvePlanTasksForCard(
  input: unknown,
  resultText: string | null | undefined
): PlanTaskPreview[] {
  const fromOutput = parsePlanTasksFromOutput(resultText)
  if (fromOutput.length > 0) return fromOutput
  return parsePlanTasksFromInput(input)
}

export function parsePlanTasksFromInput(input: unknown): PlanTaskPreview[] {
  if (!input || typeof input !== "object") return []
  const tasksRaw = (input as Record<string, unknown>).tasks

  if (Array.isArray(tasksRaw)) {
    return tasksRaw.filter(isPlanTaskPreview)
  }

  if (typeof tasksRaw !== "string" || !tasksRaw.trim()) return []

  try {
    const parsed: unknown = JSON.parse(tasksRaw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPlanTaskPreview)
  } catch {
    return []
  }
}

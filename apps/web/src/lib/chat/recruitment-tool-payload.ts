import { isToolOutputPending } from "./tool-output-pending"
import type { ToolUiActionOutbound } from "./tool-ui-action"
import { asNumber, parseJsonObject } from "./parse-utils"

export interface RecruitmentCandidateItem {
  index: number
  name: string
  description: string
  skill_ids: number[]
  skills_summary: string
}

export interface RecruitmentCandidatesPayload {
  type: "recruitment_candidates"
  workspace_id?: number
  total: number
  candidates: RecruitmentCandidateItem[]
  hint?: string
}

export interface EmployeeHiredPayload {
  type: "employee_hired"
  employee_id: number
  employee_name: string
  employee_code?: string
  skills: string[]
  message: string
}

function normalizeSkillIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((id) => (typeof id === "number" ? id : Number(id)))
    .filter((id) => Number.isFinite(id))
}

function normalizeCandidate(raw: unknown): RecruitmentCandidateItem | null {
  if (!raw || typeof raw !== "object") return null
  const c = raw as Record<string, unknown>
  const name = typeof c.name === "string" ? c.name.trim() : ""
  if (!name) return null
  const index =
    typeof c.index === "number" && Number.isFinite(c.index) ? c.index : 0
  const description = typeof c.description === "string" ? c.description : ""
  const skills_summary =
    typeof c.skills_summary === "string" ? c.skills_summary : ""
  return {
    index,
    name,
    description,
    skill_ids: normalizeSkillIds(c.skill_ids),
    skills_summary,
  }
}

export function parseRecruitmentCandidatesPayload(
  text: string | null | undefined
): RecruitmentCandidatesPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "recruitment_candidates") return null

  const candidatesRaw = obj.candidates
  if (!Array.isArray(candidatesRaw) || candidatesRaw.length === 0) {
    return null
  }

  const candidates = candidatesRaw
    .map(normalizeCandidate)
    .filter((c): c is RecruitmentCandidateItem => c !== null)
  if (candidates.length === 0) return null

  const total =
    typeof obj.total === "number" && Number.isFinite(obj.total)
      ? obj.total
      : candidates.length

  return {
    type: "recruitment_candidates",
    workspace_id:
      typeof obj.workspace_id === "number" ? obj.workspace_id : undefined,
    total,
    candidates,
    hint: typeof obj.hint === "string" ? obj.hint : undefined,
  }
}

export function parseEmployeeHiredPayload(
  text: string | null | undefined
): EmployeeHiredPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employee_hired") return null

  const employee_name =
    typeof obj.employee_name === "string" ? obj.employee_name.trim() : ""
  const employee_id =
    typeof obj.employee_id === "number" && Number.isFinite(obj.employee_id)
      ? obj.employee_id
      : null
  if (!employee_name || employee_id == null) return null

  const skillsRaw = obj.skills
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.filter((s): s is string => typeof s === "string" && !!s)
    : []

  const message =
    typeof obj.message === "string" ? obj.message : `「${employee_name}」已入职`

  return {
    type: "employee_hired",
    employee_id,
    employee_name,
    employee_code:
      typeof obj.employee_code === "string" ? obj.employee_code : undefined,
    skills,
    message,
  }
}

/** 将 skills_summary 拆成展示用标签（顿号、逗号分隔） */
export function splitSkillsSummary(summary: string): string[] {
  if (!summary.trim()) return []
  return summary
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 总管 Agent 指令：单人录用（保留工具参数字段） */
export function buildRecruitmentHireAgentMessage(
  candidate: Pick<
    RecruitmentCandidateItem,
    "name" | "description" | "skill_ids"
  >
): string {
  const name = candidate.name.trim()
  if (!name) return "录用该候选人"
  const description = (candidate.description || "").trim()
  const skillIdsJson = JSON.stringify(candidate.skill_ids ?? [])
  const lines = [`录用「${name}」`, `description: ${description || "无"}`]
  lines.push(`skill_ids: ${skillIdsJson}`)
  return lines.join("\n")
}

/** @deprecated 使用 buildRecruitmentHireAgentMessage */
export const buildRecruitmentHireMessage = buildRecruitmentHireAgentMessage

export function buildRecruitmentHireDisplayText(
  candidate: Pick<RecruitmentCandidateItem, "name">
): string {
  const name = candidate.name.trim()
  return name ? `已录用候选人：${name}` : "已录用该候选人"
}

export function buildRecruitmentHireOutbound(
  candidate: Pick<
    RecruitmentCandidateItem,
    "name" | "description" | "skill_ids"
  >
): ToolUiActionOutbound {
  return {
    agentText: buildRecruitmentHireAgentMessage(candidate),
    displayText: buildRecruitmentHireDisplayText(candidate),
    uiAction: "recruitment_hire_one",
  }
}

export function isRecruitmentToolRunning(
  state: string,
  preliminary?: boolean
): boolean {
  return isToolOutputPending(state, preliminary)
}

export interface EmployeesHiredSucceededItem {
  index: number
  employee_id: number
  employee_name: string
  employee_code?: string
  skills: string[]
}

export interface EmployeesHiredFailedItem {
  index: number
  name?: string
  error: string
}

export interface EmployeesHiredPayload {
  type: "employees_hired"
  total: number
  succeeded_count: number
  failed_count: number
  succeeded: EmployeesHiredSucceededItem[]
  failed: EmployeesHiredFailedItem[]
  message?: string
}

export type RecruitmentToolBlockKind =
  | "recruitment-candidates"
  | "employee-hired"
  | "employees-hired"

function normalizeEmployeesHiredSucceeded(
  raw: unknown
): EmployeesHiredSucceededItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const employeeId = asNumber(item.employee_id)
  const employeeName =
    typeof item.employee_name === "string" ? item.employee_name.trim() : ""
  if (employeeId == null || !employeeName) return null
  const index = asNumber(item.index) ?? 0
  const skillsRaw = item.skills
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.filter((s): s is string => typeof s === "string" && !!s)
    : []
  return {
    index,
    employee_id: employeeId,
    employee_name: employeeName,
    employee_code:
      typeof item.employee_code === "string" ? item.employee_code : undefined,
    skills,
  }
}

function normalizeEmployeesHiredFailed(
  raw: unknown
): EmployeesHiredFailedItem | null {
  if (!raw || typeof raw !== "object") return null
  const item = raw as Record<string, unknown>
  const error = typeof item.error === "string" ? item.error : ""
  if (!error) return null
  const index = asNumber(item.index) ?? 0
  const name = typeof item.name === "string" ? item.name : undefined
  return { index, name, error }
}

export function parseEmployeesHiredPayload(
  text: string | null | undefined
): EmployeesHiredPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employees_hired") return null

  const succeededRaw = obj.succeeded
  const failedRaw = obj.failed
  const succeeded = Array.isArray(succeededRaw)
    ? succeededRaw
        .map(normalizeEmployeesHiredSucceeded)
        .filter((item): item is EmployeesHiredSucceededItem => item != null)
    : []
  const failed = Array.isArray(failedRaw)
    ? failedRaw
        .map(normalizeEmployeesHiredFailed)
        .filter((item): item is EmployeesHiredFailedItem => item != null)
    : []

  const total = asNumber(obj.total) ?? succeeded.length + failed.length
  const succeededCount = asNumber(obj.succeeded_count) ?? succeeded.length
  const failedCount = asNumber(obj.failed_count) ?? failed.length

  return {
    type: "employees_hired",
    total,
    succeeded_count: succeededCount,
    failed_count: failedCount,
    succeeded,
    failed,
    message: typeof obj.message === "string" ? obj.message : undefined,
  }
}

export function isRecruitmentPlainToolError(
  resultText: string | null | undefined
): boolean {
  const text = resultText?.trim()
  if (!text) return false
  return !text.startsWith("{")
}

export function shouldRenderRecruitmentToolBlock(
  state: string,
  resultText: string | null | undefined,
  hasParsedPayload: boolean,
  preliminary?: boolean
): boolean {
  const pending = isToolOutputPending(state, preliminary)
  return (
    hasParsedPayload ||
    pending ||
    state === "output-error" ||
    (!pending && isRecruitmentPlainToolError(resultText))
  )
}

export function resolveRecruitmentToolBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined,
  preliminary?: boolean
): RecruitmentToolBlockKind | null {
  if (toolName === "recruit_employee") {
    const payload = parseRecruitmentCandidatesPayload(resultText)
    if (
      shouldRenderRecruitmentToolBlock(
        state,
        resultText,
        payload != null,
        preliminary
      )
    ) {
      return "recruitment-candidates"
    }
    return null
  }

  if (toolName === "hire_employee") {
    const payload = parseEmployeeHiredPayload(resultText)
    if (
      shouldRenderRecruitmentToolBlock(
        state,
        resultText,
        payload != null,
        preliminary
      )
    ) {
      return "employee-hired"
    }
    return null
  }

  if (toolName === "hire_employees") {
    const payload = parseEmployeesHiredPayload(resultText)
    if (
      shouldRenderRecruitmentToolBlock(
        state,
        resultText,
        payload != null,
        preliminary
      )
    ) {
      return "employees-hired"
    }
    return null
  }

  return null
}

/** 总管 Agent 指令：批量录用 */
export function buildRecruitmentHireAllAgentMessage(
  candidates: RecruitmentCandidateItem[]
): string {
  const normalized = candidates
    .filter((c) => c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      description: (c.description || "").trim() || "无",
      skill_ids: c.skill_ids ?? [],
    }))
  const count = normalized.length
  const payload = JSON.stringify(normalized, null, 2)
  return [
    `全部录用以下 ${count} 位候选人，请调用 hire_employees，candidates 参数为：`,
    payload,
  ].join("\n")
}

/** @deprecated 使用 buildRecruitmentHireAllAgentMessage */
export const buildRecruitmentHireAllMessage =
  buildRecruitmentHireAllAgentMessage

export function buildRecruitmentHireAllDisplayText(
  candidates: RecruitmentCandidateItem[]
): string {
  const names = candidates.map((c) => c.name.trim()).filter(Boolean)
  const count = names.length
  if (count === 0) return "已请求批量录用候选人"
  const preview = names.slice(0, 5).join("、")
  const suffix = names.length > 5 ? " 等" : ""
  return `已请求录用 ${count} 位候选人：${preview}${suffix}`
}

export function buildRecruitmentHireAllOutbound(
  candidates: RecruitmentCandidateItem[]
): ToolUiActionOutbound {
  return {
    agentText: buildRecruitmentHireAllAgentMessage(candidates),
    displayText: buildRecruitmentHireAllDisplayText(candidates),
    uiAction: "recruitment_hire_batch",
  }
}

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

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    return null
  }
  return null
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
  const description =
    typeof c.description === "string" ? c.description : ""
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

/** 总管对话中一键录用时发送给 orchestrator 的文案 */
export function buildRecruitmentHireMessage(
  candidate: Pick<RecruitmentCandidateItem, "name">,
): string {
  const name = candidate.name.trim()
  return name ? `录用${name}` : "录用该候选人"
}

export function isRecruitmentToolRunning(state: string): boolean {
  return (
    state === "call" ||
    state === "input-streaming" ||
    state === "input-available"
  )
}

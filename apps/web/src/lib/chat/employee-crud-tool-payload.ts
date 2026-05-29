export interface EmployeeDetailPayload {
  type: "employee_detail"
  employee_id: number
  employee_name: string
  employee_code?: string
  description?: string
  is_curator: boolean
  skills: Array<Record<string, unknown>>
  mcps: Array<Record<string, unknown>>
}

export interface EmployeeUpdatedPayload {
  type: "employee_updated"
  employee_id: number
  employee_name: string
  skills: string[]
  message: string
}

export interface EmployeeDeletedPayload {
  type: "employee_deleted"
  employee_id: number
  employee_name: string
  message: string
}

export type EmployeeCrudBlockKind =
  | "employee-detail"
  | "employee-updated"
  | "employee-deleted"

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

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "")
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function parseEmployeeDetailPayload(
  text: string | null | undefined
): EmployeeDetailPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employee_detail") return null
  const employeeId = asNumber(obj.employee_id)
  if (employeeId == null) return null
  return {
    type: "employee_detail",
    employee_id: employeeId,
    employee_name: asString(obj.employee_name),
    employee_code:
      typeof obj.employee_code === "string" ? obj.employee_code : undefined,
    description:
      typeof obj.description === "string" ? obj.description : undefined,
    is_curator: Boolean(obj.is_curator),
    skills: Array.isArray(obj.skills)
      ? obj.skills.filter((item) => item && typeof item === "object")
      : [],
    mcps: Array.isArray(obj.mcps)
      ? obj.mcps.filter((item) => item && typeof item === "object")
      : [],
  }
}

export function parseEmployeeUpdatedPayload(
  text: string | null | undefined
): EmployeeUpdatedPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employee_updated") return null
  const employeeId = asNumber(obj.employee_id)
  if (employeeId == null) return null
  return {
    type: "employee_updated",
    employee_id: employeeId,
    employee_name: asString(obj.employee_name),
    skills: Array.isArray(obj.skills)
      ? obj.skills.map((item) => asString(item)).filter(Boolean)
      : [],
    message: asString(obj.message),
  }
}

export function parseEmployeeDeletedPayload(
  text: string | null | undefined
): EmployeeDeletedPayload | null {
  if (!text?.trim()) return null
  const obj = parseJsonObject(text)
  if (!obj || obj.type !== "employee_deleted") return null
  const employeeId = asNumber(obj.employee_id)
  if (employeeId == null) return null
  return {
    type: "employee_deleted",
    employee_id: employeeId,
    employee_name: asString(obj.employee_name),
    message: asString(obj.message),
  }
}

export function isPlainToolResultError(
  resultText: string | null | undefined
): boolean {
  const text = resultText?.trim()
  if (!text) return false
  return !text.startsWith("{")
}

export function isEmployeeCrudToolRunning(state: string): boolean {
  return (
    state === "call" ||
    state === "input-streaming" ||
    state === "input-available"
  )
}

export function shouldRenderEmployeeCrudToolBlock(
  state: string,
  resultText: string | null | undefined,
  hasParsedPayload: boolean
): boolean {
  return (
    hasParsedPayload ||
    isEmployeeCrudToolRunning(state) ||
    state === "output-error" ||
    isPlainToolResultError(resultText)
  )
}

export function resolveEmployeeCrudBlockKind(
  toolName: string,
  state: string,
  resultText: string | null | undefined
): EmployeeCrudBlockKind | null {
  if (toolName === "get_employee") {
    const payload = parseEmployeeDetailPayload(resultText)
    if (shouldRenderEmployeeCrudToolBlock(state, resultText, payload != null)) {
      return "employee-detail"
    }
    return null
  }

  if (toolName === "update_employee") {
    const payload = parseEmployeeUpdatedPayload(resultText)
    if (shouldRenderEmployeeCrudToolBlock(state, resultText, payload != null)) {
      return "employee-updated"
    }
    return null
  }

  if (toolName === "delete_employee") {
    const payload = parseEmployeeDeletedPayload(resultText)
    if (shouldRenderEmployeeCrudToolBlock(state, resultText, payload != null)) {
      return "employee-deleted"
    }
    return null
  }

  return null
}

export function skillLabelsFromDetailSkills(
  skills: Array<Record<string, unknown>>
): string[] {
  return skills
    .map((skill) => {
      const zh = skill.skill_name_zh ?? skill.displayNameZh
      const name = skill.skill_name ?? skill.skillName
      if (typeof zh === "string" && zh.trim()) return zh.trim()
      if (typeof name === "string" && name.trim()) return name.trim()
      const id = skill.skill_id ?? skill.id
      return id != null ? String(id) : ""
    })
    .filter(Boolean)
}

export function mcpLabelsFromDetailMcps(
  mcps: Array<Record<string, unknown>>
): string[] {
  return mcps
    .map((mcp) => {
      const name = mcp.capability_name ?? mcp.mcp_server_name
      if (typeof name === "string" && name.trim()) return name.trim()
      const id = mcp.id ?? mcp.mcp_id
      return id != null ? `MCP ${id}` : ""
    })
    .filter(Boolean)
}

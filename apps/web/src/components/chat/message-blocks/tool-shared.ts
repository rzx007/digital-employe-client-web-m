import {
  IconCircleCheck,
  IconCode,
  IconFileDescription,
  IconFolder,
  IconListCheck,
  IconPencil,
  IconPlayerPlay,
  IconSearch,
  IconTerminal,
  IconTrash,
  IconUserPlus,
  IconUsers,
} from "@tabler/icons-react"

// ── Display content extraction ──────────────────────────

const CONTENT_TOOLS = new Set(["write_file", "edit_file"])
const COMMAND_TOOLS = new Set(["execute", "shell_execute"])

export const LARGE_FILE_PREVIEW_CHARS = 500

export function getFilePathFromToolInput(
  input: unknown,
  toolName: string
): string | null {
  if (!CONTENT_TOOLS.has(toolName)) return null
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const raw = obj.file_path
  return typeof raw === "string" && raw ? raw : null
}

export function getContentLength(input: unknown, toolName: string): number {
  const content = getDisplayContent(input, toolName)
  return content?.length ?? 0
}

export function normalizeToolFilePath(path: string): string {
  const normalized = path.replace(/\\/g, "/")
  if (normalized.startsWith("artifacts/") || normalized.startsWith("skills-draft/")) {
    return `/${normalized}`
  }
  return normalized
}

export function isArtifactLikePath(path: string): boolean {
  const normalized = normalizeToolFilePath(path)
  return normalized.startsWith("/artifacts/") || normalized.startsWith("/skills-draft/")
}

export function getDisplayContent(
  input: unknown,
  toolName: string
): string | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  if (CONTENT_TOOLS.has(toolName)) {
    if (toolName === "edit_file") {
      return typeof obj.new_string === "string" && obj.new_string
        ? obj.new_string
        : null
    }
    return typeof obj.content === "string" && obj.content ? obj.content : null
  }
  if (COMMAND_TOOLS.has(toolName)) {
    return typeof obj.command === "string" && obj.command ? obj.command : null
  }
  try {
    const json = JSON.stringify(obj, null, 2)
    return json === "{}" ? null : json
  } catch {
    return null
  }
}

export function getEditDiff(
  input: unknown
): { oldCode: string; newCode: string } | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const oldCode = typeof obj.old_string === "string" ? obj.old_string : null
  const newCode = typeof obj.new_string === "string" ? obj.new_string : null
  return oldCode != null && newCode != null ? { oldCode, newCode } : null
}

// ── Icon maps ───────────────────────────────────────────

export const TOOL_ICON_MAP: Record<string, typeof IconFileDescription> = {
  read_file: IconFileDescription,
  write_file: IconPencil,
  edit_file: IconPencil,
  execute: IconTerminal,
  shell_execute: IconTerminal,
  ls: IconFolder,
  glob: IconSearch,
  grep: IconSearch,
  write_todos: IconListCheck,
  create_orchestration_plan: IconListCheck,
  confirm_orchestration_plan: IconPlayerPlay,
  list_workspace_employees: IconUsers,
  recruit_employee: IconUserPlus,
  hire_employee: IconCircleCheck,
  update_task: IconPencil,
  delete_task: IconTrash,
  cancel_plan: IconPlayerPlay,
  list_tasks: IconListCheck,
  session_search: IconSearch,
}

export function getToolIcon(toolName: string): typeof IconFileDescription {
  return TOOL_ICON_MAP[toolName] ?? IconCode
}

// ── Todo types & helpers ────────────────────────────────

export interface TodoItem {
  content: string
  status: string
}

export function extractTodosFromInput(input: unknown): TodoItem[] | null {
  if (!input || typeof input !== "object") return null
  const todos = (input as Record<string, unknown>).todos
  if (!Array.isArray(todos) || todos.length === 0) return null
  return todos.map((t: Record<string, unknown>) => ({
    content:
      typeof t.content === "string" ? t.content : String(t.content ?? ""),
    status: typeof t.status === "string" ? t.status : "pending",
  }))
}

export function extractTodosFromOutputText(text: string): TodoItem[] | null {
  const match = text.match(/Updated todo list to\s*(\[[\s\S]*\])/)
  if (!match) return null
  try {
    let jsonStr = match[1]
    jsonStr = jsonStr.replace(/'/g, '"')
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return null
    return parsed.map((t: Record<string, unknown>) => ({
      content:
        typeof t.content === "string" ? t.content : String(t.content ?? ""),
      status: typeof t.status === "string" ? t.status : "pending",
    }))
  } catch {
    return null
  }
}

export function getTodos(
  input: unknown,
  resultText: string | null | undefined
): TodoItem[] | null {
  return (
    extractTodosFromInput(input) ??
    (resultText ? extractTodosFromOutputText(resultText) : null)
  )
}

export function countCompleted(todos: TodoItem[]): number {
  return todos.filter((t) => t.status === "completed").length
}

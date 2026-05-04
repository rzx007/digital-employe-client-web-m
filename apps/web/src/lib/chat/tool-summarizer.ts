const MAX_LABEL_LENGTH = 60

function extractBasename(path: string): string {
  const segments = path.split(/[/\\]/)
  return segments[segments.length - 1] || path
}

export interface ToolCallSummary {
  toolName: string
  label: string
  filePath?: string
  icon: string
}

const TOOL_META: Record<
  string,
  { icon: string; verb: string; pathKey?: string }
> = {
  read_file: { icon: "📄", verb: "读取", pathKey: "file_path" },
  write_file: { icon: "✏️", verb: "创建", pathKey: "file_path" },
  edit_file: { icon: "✏️", verb: "编辑", pathKey: "file_path" },
  execute: { icon: "⚡", verb: "执行" },
  ls: { icon: "📁", verb: "列出目录", pathKey: "path" },
  download_files: { icon: "📥", verb: "下载", pathKey: "paths" },
  upload_files: { icon: "📤", verb: "上传", pathKey: "files" },
  write_todos: { icon: "📋", verb: "规划任务" },
  create_orchestration_plan: { icon: "📋", verb: "生成编排计划" },
}

function extractToolName(type: string): string {
  if (type.startsWith("tool-")) {
    return type.slice(5)
  }
  return type
}

function truncate(text: string, max = MAX_LABEL_LENGTH): string {
  return text.length > max ? text.slice(0, max - 1) + "..." : text
}

function extractScriptBasename(command: string): string | null {
  const match = command.match(/([^\s/\\]+\.(?:py|sh|js|ts))\b/)
  return match ? match[1] : null
}

export const SIMPLE_LABELS: Record<string, { running: string; done: string; error: string }> = {
  execute: { running: "正在执行命令...", done: "执行完成", error: "执行失败" },
  read_file: { running: "正在读取文件...", done: "读取完成", error: "读取失败" },
  write_file: { running: "正在创建文件...", done: "创建完成", error: "创建失败" },
  edit_file: { running: "正在编辑文件...", done: "编辑完成", error: "编辑失败" },
  ls: { running: "正在查看目录...", done: "查看完成", error: "查看失败" },
  download_files: { running: "正在下载...", done: "下载完成", error: "下载失败" },
  upload_files: { running: "正在上传...", done: "上传完成", error: "上传失败" },
  write_todos: { running: "正在规划任务...", done: "任务已规划", error: "规划失败" },
  glob: { running: "正在搜索文件...", done: "搜索完成", error: "搜索失败" },
}

export function getSimpleLabel(
  toolName: string,
  state: "running" | "done" | "error"
): string {
  return SIMPLE_LABELS[toolName]?.[state] ?? (state === "running" ? "处理中..." : state === "error" ? "操作失败" : "已完成")
}

export function summarizeToolCall(options: {
  type: string
  input?: unknown
}): ToolCallSummary {
  const toolName = extractToolName(options.type)
  const meta = TOOL_META[toolName]
  const input = options.input as Record<string, unknown> | undefined

  if (!meta) {
    return { toolName, label: toolName, icon: "🔧" }
  }

  let filePath: string | undefined

  if (meta.pathKey && input) {
    const raw = input[meta.pathKey]
    if (typeof raw === "string") {
      filePath = raw
    } else if (Array.isArray(raw) && raw.length > 0) {
      filePath = raw.join(", ")
    }
  }

  if (toolName === "execute" && input?.command) {
    const cmd = String(input.command)
    const script = extractScriptBasename(cmd)
    const label = script
      ? `${meta.verb} ${script}`
      : truncate(`${meta.verb} ${cmd}`)
    return { toolName, label, icon: meta.icon }
  }

  if (toolName === "write_todos") {
    return { toolName, label: "任务列表", icon: meta.icon }
  }

  const displayName = filePath ? extractBasename(filePath) : undefined

  const label = displayName
    ? `${meta.verb} ${truncate(displayName)}`
    : meta.verb

  return { toolName, label, filePath, icon: meta.icon }
}

// ── Skill path detection ────────────────────────────────────

const SKILL_PATH_KEYS: Record<string, string> = {
  read_file: "file_path",
  ls: "path",
  glob: "path",
  grep: "path",
}

export function isSkillToolCall(input: unknown, toolName: string): boolean {
  const pathKey = SKILL_PATH_KEYS[toolName]
  if (!pathKey || !input || typeof input !== "object") return false
  const obj = input as Record<string, unknown>
  const val = obj[pathKey]
  if (typeof val !== "string") return false
  return val.startsWith("/skills/") || val.startsWith("/skills-draft/")
}

export function extractSkillName(input: unknown, toolName: string): string | null {
  const pathKey = SKILL_PATH_KEYS[toolName]
  if (!pathKey || !input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const val = obj[pathKey]
  if (typeof val !== "string") return null
  const match = val.match(/\/skills-(?:draft\/|\/)([^/]+)/)
  if (match) return match[1]
  return null
}

export function summarizeToolGroup(
  summaries: ToolCallSummary[]
): string {
  if (summaries.length === 0) return ""
  if (summaries.length === 1) return summaries[0].label

  const counts = new Map<string, number>()
  for (const s of summaries) {
    counts.set(s.toolName, (counts.get(s.toolName) ?? 0) + 1)
  }

  const parts = Array.from(counts.entries()).map(([name, count]) => {
    const meta = TOOL_META[name]
    const verb = meta?.verb ?? name
    return count > 1 ? `${count} 次${verb}` : verb
  })

  return `${summaries.length} 项操作 (${parts.join("、")})`
}

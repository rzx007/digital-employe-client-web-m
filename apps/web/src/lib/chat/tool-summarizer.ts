const MAX_LABEL_LENGTH = 60

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

  const label = filePath
    ? `${meta.verb} ${truncate(filePath)}`
    : meta.verb

  return { toolName, label, filePath, icon: meta.icon }
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

import {
  getToolDisplay,
  INTENT_MAX_LENGTH,
  isBusinessTool,
  normalizeShellIntent,
  SHELL_TOOL_NAMES,
} from "./tool-label-registry"

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

function extractToolName(type: string): string {
  if (type.startsWith("tool-")) {
    return type.slice(5)
  }
  return type
}

function truncate(text: string, max = MAX_LABEL_LENGTH): string {
  return text.length > max ? text.slice(0, max - 1) + "..." : text
}

function shortMarketSkillSlug(slug: unknown): string | null {
  if (typeof slug !== "string" || !slug.trim()) return null
  const parts = slug.trim().split("-")
  const tail = parts.slice(-3).join("-")
  return truncate(tail || slug.trim(), 36)
}

function extractScriptBasename(command: string): string | null {
  const match = command.match(/([^\s/\\]+\.(?:py|sh|js|ts))\b/)
  return match ? match[1] : null
}

function labelFromIntent(input?: Record<string, unknown>): string | null {
  const normalized = normalizeShellIntent(input?.intent)
  if (!normalized) return null
  return truncate(normalized, INTENT_MAX_LENGTH)
}

function summarizeShellCommand(
  toolName: string,
  display: { icon: string; verb: string },
  input?: Record<string, unknown>
): ToolCallSummary {
  const fromIntent = labelFromIntent(input)
  if (fromIntent) {
    return { toolName, label: fromIntent, icon: display.icon }
  }
  const cmd = input?.command
  if (typeof cmd === "string") {
    const script = extractScriptBasename(cmd)
    const label = script
      ? `${display.verb} ${script}`
      : truncate(`${display.verb} ${cmd}`)
    return { toolName, label, icon: display.icon }
  }
  return { toolName, label: display.verb, icon: display.icon }
}

export function summarizeToolCall(options: {
  type: string
  input?: unknown
}): ToolCallSummary {
  const toolName = extractToolName(options.type)
  const display = getToolDisplay(toolName)
  const input = options.input as Record<string, unknown> | undefined

  if (!display) {
    return { toolName, label: toolName, icon: "🔧" }
  }

  if (SHELL_TOOL_NAMES.has(toolName)) {
    return summarizeShellCommand(toolName, display, input)
  }

  if (isBusinessTool(toolName)) {
    if (toolName === "get_market_skill_detail") {
      const short = shortMarketSkillSlug(input?.skill_slug)
      return {
        toolName,
        label: short ? `预览技能 ${short}` : display.label,
        icon: display.icon,
      }
    }
    if (toolName === "get_workspace_skill_detail") {
      const name =
        typeof input?.skill_name === "string" ? input.skill_name.trim() : ""
      const lid = input?.local_id
      const label = name
        ? `预览技能 ${truncate(name, 20)}`
        : typeof lid === "number"
          ? `预览技能 #${lid}`
          : display.label
      return { toolName, label, icon: display.icon }
    }
    if (toolName === "install_market_skill") {
      const short = shortMarketSkillSlug(input?.skill_slug)
      return {
        toolName,
        label: short ? `安装技能 ${short}` : display.label,
        icon: display.icon,
      }
    }
    if (toolName === "search_market_skills") {
      const q = input?.query
      const label =
        typeof q === "string" && q.trim()
          ? `搜索技能「${truncate(q.trim(), 24)}」`
          : display.label
      return { toolName, label, icon: display.icon }
    }
    return { toolName, label: display.label, icon: display.icon }
  }

  if (toolName === "write_todos") {
    return { toolName, label: display.label, icon: display.icon }
  }

  let filePath: string | undefined
  if (display.pathKey && input) {
    const raw = input[display.pathKey]
    if (typeof raw === "string") {
      filePath = raw
    } else if (Array.isArray(raw) && raw.length > 0) {
      filePath = raw.join(", ")
    }
  }

  const displayName = filePath ? extractBasename(filePath) : undefined
  const label = displayName
    ? `${display.verb} ${truncate(displayName)}`
    : display.label

  return { toolName, label, filePath, icon: display.icon }
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
  // 真实路径含 skills/ 或 skills-draft/ 目录段（去虚拟前缀后按段匹配）
  return /(^|\/)skills(?:-draft)?\//.test(val.replace(/\\/g, "/"))
}

export function extractSkillName(
  input: unknown,
  toolName: string
): string | null {
  const pathKey = SKILL_PATH_KEYS[toolName]
  if (!pathKey || !input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>
  const val = obj[pathKey]
  if (typeof val !== "string") return null
  // 取 skills/ 或 skills-draft/ 段之后的技能目录名（真实路径或旧虚拟路径均适用）
  const match = val.replace(/\\/g, "/").match(/(?:^|\/)skills(?:-draft)?\/([^/]+)/)
  if (match) return match[1]
  return null
}

export function summarizeToolGroup(summaries: ToolCallSummary[]): string {
  if (summaries.length === 0) return ""
  if (summaries.length === 1) return summaries[0].label

  const counts = new Map<string, number>()
  for (const s of summaries) {
    counts.set(s.toolName, (counts.get(s.toolName) ?? 0) + 1)
  }

  const parts = Array.from(counts.entries()).map(([name, count]) => {
    const verb = getToolDisplay(name)?.verb ?? name
    return count > 1 ? `${count} 次${verb}` : verb
  })

  return `${summaries.length} 项操作 (${parts.join("、")})`
}

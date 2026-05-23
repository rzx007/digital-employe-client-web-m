import type { UIMessage } from "ai"

type ToolPart = Extract<UIMessage["parts"][number], { type: `tool-${string}` }>

export type FileChangeAction = "created" | "edited"

export interface FileChangeItem {
  id: string
  kind: "file" | "skill-folder"
  action: FileChangeAction
  title: string
  path: string
  extension?: string
  size?: number
  toolCallId: string
}

function isToolPart(part: UIMessage["parts"][number]): part is ToolPart {
  return part.type.startsWith("tool-") && "toolCallId" in part
}

function isCompletedToolPart(part: ToolPart) {
  return (
    "state" in part &&
    part.state === "output-available" &&
    !("preliminary" in part && part.preliminary === true)
  )
}

function getToolName(part: ToolPart) {
  return part.type.replace(/^tool-/, "")
}

function getToolInput(part: ToolPart): Record<string, unknown> | null {
  if (!("input" in part) || !part.input || typeof part.input !== "object") {
    return null
  }

  return part.input as Record<string, unknown>
}

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/")
  if (
    normalized.startsWith("artifacts/") ||
    normalized.startsWith("skills-draft/")
  ) {
    return `/${normalized}`
  }

  return normalized
}

/** 与后端非用户产物路径一致；此类 write/edit 不展示 FileChangeCard */
const INTERNAL_FILE_PREFIXES = [
  "/memories/",
  "/agent/",
  "/conversation_history/",
  "/large_tool_results/",
  "/skills/",
  "/uploads/",
] as const

function isUserVisibleFileChange(path: string): boolean {
  const normalized = normalizePath(path)
  if (normalized.startsWith("/artifacts/")) return true
  if (normalized.startsWith("/skills-draft/")) return true
  if (INTERNAL_FILE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false
  }
  return false
}

function getBasename(path: string) {
  const normalized = normalizePath(path)
  const segments = normalized.split("/").filter(Boolean)
  return segments.at(-1) ?? path
}

function getExtension(path: string) {
  const filename = getBasename(path)
  const dotIndex = filename.lastIndexOf(".")
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return undefined
  }
  return filename.slice(dotIndex + 1).toLowerCase()
}

function getContentSize(
  input: Record<string, unknown>,
  action: FileChangeAction
) {
  const contentKey = action === "created" ? "content" : "new_string"
  const content = input[contentKey]
  return typeof content === "string" ? content.length : undefined
}

function getSkillDraftFolder(path: string) {
  const normalized = normalizePath(path)
  const segments = normalized.split("/").filter(Boolean)
  if (segments[0] !== "skills-draft" || !segments[1]) {
    return null
  }

  return {
    name: segments[1],
    path: `/skills-draft/${segments[1]}`,
  }
}

function buildFileChange(part: ToolPart): FileChangeItem | null {
  const toolName = getToolName(part)
  const action: FileChangeAction | null =
    toolName === "write_file"
      ? "created"
      : toolName === "edit_file"
        ? "edited"
        : null

  if (!action || !isCompletedToolPart(part)) {
    return null
  }

  const input = getToolInput(part)
  const rawFilePath = input?.file_path
  if (typeof rawFilePath !== "string" || !rawFilePath) {
    return null
  }

  const path = normalizePath(rawFilePath)
  if (!isUserVisibleFileChange(path)) {
    return null
  }

  const skillFolder = getSkillDraftFolder(path)
  if (skillFolder) {
    return {
      id: `skill-folder:${skillFolder.path}`,
      kind: "skill-folder",
      action,
      title: skillFolder.name,
      path: skillFolder.path,
      toolCallId: part.toolCallId,
    }
  }

  return {
    id: `file:${path}`,
    kind: "file",
    action,
    title: getBasename(path),
    path,
    extension: getExtension(path),
    size: getContentSize(input, action),
    toolCallId: part.toolCallId,
  }
}

export function getFileChangesFromUIMessage(
  message: UIMessage
): FileChangeItem[] {
  const changes = new Map<string, FileChangeItem>()

  for (const part of message.parts) {
    if (!isToolPart(part)) {
      continue
    }

    const change = buildFileChange(part)
    if (!change) {
      continue
    }

    changes.set(change.id, change)
  }

  return Array.from(changes.values())
}

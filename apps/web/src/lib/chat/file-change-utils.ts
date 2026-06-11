import type { UIMessage } from "ai"
import { normalizeToolPart } from "./tools/normalize-tool-part"
import { isToolUIPart, type ToolUIPart } from "./tools/tool-part"
import { normalizeToolFilePath } from "@/components/chat/message-blocks/tool-shared"
import {
  getResourceBucket,
  toBucketRelativeSegments,
} from "@/lib/chat/pending-resources/paths"

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

function isUserVisibleFileChange(path: string): boolean {
  // 仅交付物桶（产物 / 草稿技能）的写入展示 FileChangeCard；
  // 真实路径里仍含 artifacts/ 或 skills-draft/ 段，按桶判定（uploads/skills 等不展示）。
  const bucket = getResourceBucket(path)
  return bucket === "artifacts" || bucket === "skills_draft"
}

function getBasename(path: string) {
  const normalized = normalizeToolFilePath(path)
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
  input: unknown,
  action: FileChangeAction
) {
  if (!input || typeof input !== "object") return undefined
  const contentKey = action === "created" ? "content" : "new_string"
  const content = (input as Record<string, unknown>)[contentKey]
  return typeof content === "string" ? content.length : undefined
}

function getSkillDraftFolder(path: string) {
  const normalized = normalizeToolFilePath(path)
  if (getResourceBucket(normalized) !== "skills_draft") {
    return null
  }
  const rel = toBucketRelativeSegments(normalized)
  const name = rel[0]
  if (!name) return null
  // 草稿技能文件夹的真实绝对路径（截到 skills-draft/<name>）
  const m = normalized.match(/^(.*\/skills-draft\/[^/]+)/)
  return {
    name,
    path: m ? m[1]! : name,
  }
}

function buildFileChange(part: ToolUIPart): FileChangeItem | null {
  const vm = normalizeToolPart(part)
  const action: FileChangeAction | null =
    vm.toolName === "write_file"
      ? "created"
      : vm.toolName === "edit_file"
        ? "edited"
        : null

  if (!action || vm.state !== "output-available" || vm.preliminary) {
    return null
  }

  const rawFilePath = (vm.input as Record<string, unknown>)?.file_path
  if (typeof rawFilePath !== "string" || !rawFilePath) {
    return null
  }

  const path = normalizeToolFilePath(rawFilePath)
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
    size: getContentSize(vm.input, action),
    toolCallId: part.toolCallId,
  }
}

export function getFileChangesFromUIMessage(
  message: UIMessage
): FileChangeItem[] {
  const changes = new Map<string, FileChangeItem>()

  for (const part of message.parts) {
    if (!isToolUIPart(part)) {
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

/** 当前轮（最后一条 user 之后）的首条 assistant；尚无回复时为 null */
export function getCurrentTurnAssistantMessageId(
  messages: UIMessage[]
): string | null {
  let lastUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      lastUserIndex = i
      break
    }
  }
  if (lastUserIndex < 0) {
    return null
  }
  for (let i = lastUserIndex + 1; i < messages.length; i++) {
    const message = messages[i]
    if (message?.role === "assistant") {
      return message.id
    }
  }
  return null
}

/** 仅对「当前轮流式中的 assistant」在回合未结束前隐藏文件变更卡片 */
export function shouldIncludeFileChangesForMessage(
  message: UIMessage,
  messages: UIMessage[],
  hasCurrentTurnEnded: boolean
): boolean {
  if (message.role !== "assistant") {
    return false
  }
  const currentTurnAssistantId = getCurrentTurnAssistantMessageId(messages)
  if (currentTurnAssistantId == null) {
    return true
  }
  if (message.id !== currentTurnAssistantId) {
    return true
  }
  return hasCurrentTurnEnded
}

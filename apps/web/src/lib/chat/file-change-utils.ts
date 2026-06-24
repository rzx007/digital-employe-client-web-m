import type { UIMessage } from "ai"
import { normalizeToolPart } from "./tools/normalize-tool-part"
import { isToolUIPart, type ToolUIPart } from "./tools/tool-part"
import { normalizeToolFilePath } from "@/components/chat/message-blocks/tool-shared"
import {
  getResourceBucket,
  toBucketRelativeSegments,
} from "@/lib/chat/pending-resources/paths"

export type FileChangeAction = "created" | "edited"

/**
 * 交付物 vs 中间产物：用户关心的是 Word/PPTX/MD 等成果（deliverable），
 * 而非生成它们用的脚本/依赖（intermediate）。面板据此分区展示。
 */
export type FileChangeCategory = "deliverable" | "intermediate"

export interface FileChangeItem {
  id: string
  kind: "file" | "skill-folder"
  category: FileChangeCategory
  action: FileChangeAction
  title: string
  path: string
  extension?: string
  size?: number
  toolCallId: string
}

// 代码/脚本扩展名 → 中间产物（口径对齐后端 artifacts.py _ARTIFACT_CODE_EXTENSIONS，
// 另补常见脚本类型）。其余（文档/表格/图片/文本）默认视为交付物。
const INTERMEDIATE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "json",
  "py",
  "sql",
  "css",
  "java",
  "go",
  "rs",
  "cpp",
  "c",
  "h",
  "sh",
  "bat",
  "ps1",
  "rb",
  "lock",
  "toml",
  "ini",
  "cfg",
  "yaml",
  "yml",
])

// 已知依赖/构建清单文件名 → 中间产物（与扩展名无关，按文件名整体匹配）。
const INTERMEDIATE_FILENAMES = new Set([
  "requirements.txt",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "poetry.lock",
  ".gitignore",
  "dockerfile",
  "makefile",
])

/** 判定文件是用户要的交付物，还是生成交付物用的脚本/依赖。 */
function classifyFileCategory(
  basename: string,
  extension: string | undefined
): FileChangeCategory {
  if (INTERMEDIATE_FILENAMES.has(basename.toLowerCase())) {
    return "intermediate"
  }
  if (extension && INTERMEDIATE_EXTENSIONS.has(extension)) {
    return "intermediate"
  }
  return "deliverable"
}

/** 据路径判定交付物 / 中间产物（供「团队交付物」聚合卡分区，复用同一口径）。 */
export function categorizeArtifactPath(path: string): FileChangeCategory {
  return classifyFileCategory(getBasename(path), getExtension(path))
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

function getContentSize(input: unknown, action: FileChangeAction) {
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

function buildFileChange(
  part: ToolUIPart,
  skillFoldersWithManifest: Set<string>
): FileChangeItem | null {
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
  // 仅当该草稿文件夹本轮写过 SKILL.md（真正技能的标志）才作为 skill-folder；
  // 否则降级为普通文件变更（agent 把脚本临时丢进 skills-draft 不算新技能）。
  if (skillFolder && skillFoldersWithManifest.has(skillFolder.path)) {
    // 草稿技能是用户要导入的成果，恒为交付物
    return {
      id: `skill-folder:${skillFolder.path}`,
      kind: "skill-folder",
      category: "deliverable",
      action,
      title: skillFolder.name,
      path: skillFolder.path,
      toolCallId: part.toolCallId,
    }
  }

  const basename = getBasename(path)
  const extension = getExtension(path)
  return {
    id: `file:${path}`,
    kind: "file",
    category: classifyFileCategory(basename, extension),
    action,
    title: basename,
    path,
    extension,
    size: getContentSize(vm.input, action),
    toolCallId: part.toolCallId,
  }
}

/** 该 skills-draft 写入是否为 SKILL.md（真正技能的标志文件）。 */
function isSkillManifestWrite(path: string): boolean {
  if (getResourceBucket(path) !== "skills_draft") return false
  return getBasename(path).toLowerCase() === "skill.md"
}

export function getFileChangesFromUIMessage(
  message: UIMessage
): FileChangeItem[] {
  const changes = new Map<string, FileChangeItem>()
  // 真正的技能必须有 SKILL.md。记录本轮写过 SKILL.md 的草稿技能文件夹路径，
  // 只有这些文件夹的 skill-folder 项才视为「草稿技能」（弹保存卡）；
  // 否则只是 agent 把脚本临时丢进 skills-draft，不该被当成新技能。
  const skillFoldersWithManifest = new Set<string>()

  for (const part of message.parts) {
    if (!isToolUIPart(part)) {
      continue
    }
    const vm = normalizeToolPart(part)
    const rawPath = (vm.input as Record<string, unknown>)?.file_path
    if (typeof rawPath === "string" && isSkillManifestWrite(rawPath)) {
      const folder = getSkillDraftFolder(normalizeToolFilePath(rawPath))
      if (folder) skillFoldersWithManifest.add(folder.path)
    }
  }

  for (const part of message.parts) {
    if (!isToolUIPart(part)) {
      continue
    }

    const change = buildFileChange(part, skillFoldersWithManifest)
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

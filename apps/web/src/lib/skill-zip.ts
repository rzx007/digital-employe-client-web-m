import JSZip from "jszip"

export interface ParsedSkillZip {
  skillName: string
  description: string
  promptContent: string
  skillMdContent: string
  fileName: string
  fileSize: number
}

const SKILL_MD_NAME = "SKILL.md"
const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

function isIgnoredEntry(path: string): boolean {
  if (!path) return true
  if (path.endsWith("/")) return true
  if (path.startsWith("__MACOSX/")) return true
  const segments = path.split("/")
  return segments.some((seg) => seg === ".DS_Store")
}

function parseFrontmatter(content: string): {
  description: string
  body: string
} {
  const match = content.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) {
    return { description: "", body: content }
  }
  const frontmatterText = match[1]
  const body = content.slice(match[0].length)

  const descMatch = frontmatterText.match(
    /^[ \t]*description[ \t]*[:：][ \t]*(.+?)[ \t]*$/im
  )
  const description = descMatch
    ? descMatch[1].trim().replace(/^["']|["']$/g, "")
    : ""

  return { description, body }
}

function deriveSkillNameFromFile(fileName: string): string {
  return fileName.replace(/\.zip$/i, "").trim()
}

function sanitizeSkillName(raw: string, fallback: string): string {
  const trimmed = (raw || "").trim()
  if (trimmed && SKILL_NAME_PATTERN.test(trimmed)) {
    return trimmed
  }
  return fallback
}

export async function parseSkillZip(file: File): Promise<ParsedSkillZip> {
  const buffer = await file.arrayBuffer()
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error("上传文件不是有效 ZIP")
  }

  const skillMdEntries: Array<{ path: string; entry: JSZip.JSZipObject }> = []
  zip.forEach((relativePath, entry) => {
    if (entry.dir) return
    if (isIgnoredEntry(relativePath)) return
    const segments = relativePath.split("/")
    const last = segments[segments.length - 1]
    if (last === SKILL_MD_NAME) {
      skillMdEntries.push({ path: relativePath, entry })
    }
  })

  if (skillMdEntries.length === 0) {
    throw new Error("ZIP 中未找到 SKILL.md，非标准技能包")
  }
  if (skillMdEntries.length > 1) {
    throw new Error("ZIP 中包含多个 SKILL.md，无法确定唯一技能目录")
  }

  const { path, entry } = skillMdEntries[0]
  const skillMdContent = await entry.async("string")
  const { description, body } = parseFrontmatter(skillMdContent)

  const segments = path.split("/").filter(Boolean)
  const fallbackName = deriveSkillNameFromFile(file.name)
  const inferredName =
    segments.length > 1
      ? sanitizeSkillName(segments[segments.length - 2], fallbackName)
      : fallbackName

  return {
    skillName: inferredName,
    description,
    promptContent: body.trim(),
    skillMdContent,
    fileName: file.name,
    fileSize: file.size,
  }
}

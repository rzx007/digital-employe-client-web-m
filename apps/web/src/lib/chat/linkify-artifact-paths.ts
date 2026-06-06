/**
 * 将最终回复正文里裸露的产物路径（/artifacts、/uploads、/skills-draft）
 * 包装成 markdown 链接，链接文字取文件名（basename），href 保留完整路径。
 *
 * 渲染时由自定义 `a` 组件（artifact-path-chip）识别这些链接，渲染成行内可点芯片。
 *
 * 规则：
 *   - 仅处理「正文」区域；代码块（``` ```）、行内代码（`…`）、已有的
 *     markdown 链接 `[..](..)` 与自动链接 `<..>` 一律跳过，避免重复包装或破坏代码。
 *   - 已经是 markdown 链接 / 自动链接的产物路径，原样保留——它们的 href 仍是产物
 *     路径，自定义 `a` 组件同样会渲染成芯片。
 */

/** 受保护区域：围栏代码 / 行内代码 / 已有链接 / 自动链接——内部路径不处理 */
const PROTECTED_RE = /(```[\s\S]*?```|`[^`]*`|\[[^\]]*\]\([^)]*\)|<[^>]+>)/g

/**
 * 产物路径：以 /artifacts | /uploads | /skills-draft 开头，
 * 路径体可含中英文、数字、`-_./`，遇到空白、括号、引号、CJK/markdown 标点即终止。
 */
const ARTIFACT_PATH_RE =
  // eslint-disable-next-line no-misleading-character-class
  /\/(?:artifacts|uploads|skills-draft)\/[^\s)\]}>，。、；；：！？（）【】「」『』""''*|`"']+/g

/** 匹配尾随的 ASCII 句读，避免把句末标点吞进路径 */
const TRAILING_PUNCT_RE = /[.,;:!?]+$/

export function basenameOfPath(path: string): string {
  const parts = path.split("/")
  return parts[parts.length - 1] || path
}

function linkifyPlainSegment(segment: string): string {
  return segment.replace(ARTIFACT_PATH_RE, (match) => {
    const trailing = TRAILING_PUNCT_RE.exec(match)?.[0] ?? ""
    const path = trailing
      ? match.slice(0, match.length - trailing.length)
      : match
    if (!path) return match
    return `[${basenameOfPath(path)}](<${path}>)${trailing}`
  })
}

export function linkifyArtifactPaths(text: string): string {
  if (!text || typeof text !== "string") return text
  if (
    !text.includes("/artifacts/") &&
    !text.includes("/uploads/") &&
    !text.includes("/skills-draft/")
  ) {
    return text
  }

  // 以受保护区域为分隔切片：偶数下标是正文，奇数下标是受保护片段（原样保留）
  const parts = text.split(PROTECTED_RE)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = linkifyPlainSegment(parts[i])
  }
  return parts.join("")
}

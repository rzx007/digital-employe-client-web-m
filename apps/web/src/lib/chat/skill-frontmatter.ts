export function parseSimpleFrontmatter(content: string): {
  description: string
  body: string
} {
  const match = content.match(/^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/)
  if (!match) {
    return { description: "", body: content }
  }
  const frontmatterText = match[1]
  const body = content.slice(match[0].length)
  const descMatch = frontmatterText.match(/description\s*[:：]\s*(.+)/)
  const description = descMatch
    ? descMatch[1].trim().replace(/^["']|["']$/g, "")
    : ""
  return { description, body }
}

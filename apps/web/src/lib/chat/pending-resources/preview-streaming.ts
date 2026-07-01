export type ArtifactRendererKind =
  | "markdown"
  | "html"
  | "sheet"
  | "image"
  | "document"
  | "code"

export type StreamingPreviewMode = "live" | "placeholder"

const DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
])

function getFileExtension(path: string | null | undefined): string | null {
  if (!path) return null
  const ext = path.split(".").pop()?.toLowerCase()
  return ext || null
}

export function isMarkdownPath(path: string | null | undefined): boolean {
  const ext = getFileExtension(path)
  return ext === "md" || ext === "markdown"
}

export function isHtmlPath(path: string | null | undefined): boolean {
  const ext = getFileExtension(path)
  return ext === "html" || ext === "htm"
}

export function isDocumentPath(path: string | null | undefined): boolean {
  const ext = getFileExtension(path)
  return ext ? DOCUMENT_EXTENSIONS.has(ext) : false
}

export function resolveRendererKindFromPath(
  filePath: string | null | undefined,
  artifactType?: string | null
): ArtifactRendererKind {
  if (isMarkdownPath(filePath)) return "markdown"
  if (isHtmlPath(filePath)) return "html"
  if (artifactType === "sheet") return "sheet"
  if (artifactType === "image") return "image"
  if (artifactType === "document" || isDocumentPath(filePath)) {
    return "document"
  }
  return "code"
}

export function resolveStreamingPreviewMode(
  filePath: string | null | undefined,
  artifactType?: string | null
): StreamingPreviewMode {
  const kind = resolveRendererKindFromPath(filePath, artifactType)
  switch (kind) {
    case "html":
    case "document":
    case "image":
    case "sheet":
      return "placeholder"
    case "markdown":
    case "code":
    default:
      return "live"
  }
}

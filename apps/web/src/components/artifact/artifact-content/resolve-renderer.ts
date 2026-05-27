import type { ComponentType } from "react"
import type { Artifact } from "../artifact-types"
import { CodeRenderer } from "./code-renderer"
import { DocViewerRenderer } from "./doc-viewer-renderer"
import { HtmlArtifactRenderer } from "./html-artifact-renderer"
import { ImageRenderer } from "./image-renderer"
import { MarkdownArtifactRenderer } from "./markdown-artifact-renderer"
import { SheetRenderer } from "./sheet-renderer"

const renderers: Record<
  string,
  ComponentType<{ artifact: Artifact; className?: string }>
> = {
  text: CodeRenderer,
  code: CodeRenderer,
  sheet: SheetRenderer,
  image: ImageRenderer,
  "skill-draft": CodeRenderer,
  document: DocViewerRenderer,
}

export function getFileExtension(
  path: string | null | undefined
): string | null {
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

export function resolveArtifactRenderer(
  artifact: Artifact,
  filePath: string | null | undefined
): ComponentType<{ artifact: Artifact; className?: string }> {
  if (isMarkdownPath(filePath)) {
    return MarkdownArtifactRenderer
  }
  if (isHtmlPath(filePath)) {
    return HtmlArtifactRenderer
  }
  return renderers[artifact.type] ?? CodeRenderer
}

export function getPreviewableTypeLabel(
  path: string | null | undefined
): string | null {
  if (isMarkdownPath(path)) return "Markdown"
  if (isHtmlPath(path)) return "HTML"
  return null
}

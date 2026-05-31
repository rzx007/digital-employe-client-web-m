import type { ComponentType } from "react"
import type { Artifact } from "../artifact-types"
import { CodeRenderer } from "./code-renderer"
import { DocViewerRenderer } from "./doc-viewer-renderer"
import { HtmlArtifactRenderer } from "./html-artifact-renderer"
import { ImageRenderer } from "./image-renderer"
import { MarkdownArtifactRenderer } from "./markdown-artifact-renderer"
import { SheetRenderer } from "./sheet-renderer"

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

export function isPptxPath(path: string | null | undefined): boolean {
  return getFileExtension(path) === "pptx"
}

export function isLegacyPptPath(path: string | null | undefined): boolean {
  return getFileExtension(path) === "ppt"
}

export type ArtifactRendererKind =
  | "markdown"
  | "html"
  | "sheet"
  | "image"
  | "pptx"
  | "legacy-ppt"
  | "document"
  | "code"

export function resolveArtifactRendererKind(
  artifact: Artifact,
  filePath: string | null | undefined
): ArtifactRendererKind {
  if (isMarkdownPath(filePath)) return "markdown"
  if (isHtmlPath(filePath)) return "html"
  if (isPptxPath(filePath)) return "pptx"
  if (isLegacyPptPath(filePath)) return "legacy-ppt"
  if (artifact.type === "sheet") return "sheet"
  if (artifact.type === "image") return "image"
  if (artifact.type === "document") return "document"
  return "code"
}

export function resolveArtifactRenderer(
  artifact: Artifact,
  filePath: string | null | undefined
): ComponentType<{ artifact: Artifact; className?: string }> {
  const kind = resolveArtifactRendererKind(artifact, filePath)
  if (kind === "markdown") return MarkdownArtifactRenderer
  if (kind === "html") return HtmlArtifactRenderer
  if (kind === "sheet") return SheetRenderer
  if (kind === "image") return ImageRenderer
  if (kind === "document") return DocViewerRenderer
  return CodeRenderer
}

export function getPreviewableTypeLabel(
  path: string | null | undefined
): string | null {
  if (isMarkdownPath(path)) return "Markdown"
  if (isHtmlPath(path)) return "HTML"
  return null
}

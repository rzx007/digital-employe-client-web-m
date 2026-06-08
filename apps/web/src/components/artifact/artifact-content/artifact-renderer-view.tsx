import * as React from "react"
import type { Artifact } from "../artifact-types"
import { CodeRenderer } from "./code-renderer"
import { DocViewerRenderer } from "./doc-viewer-renderer"
import { HtmlArtifactRenderer } from "./html-artifact-renderer"
import { ImageRenderer } from "./image-renderer"
import { LegacyPptArtifactRenderer } from "./legacy-ppt-artifact-renderer"
import { LegacyOfficeArtifactRenderer } from "./legacy-office-artifact-renderer"
import { MarkdownArtifactRenderer } from "./markdown-artifact-renderer"
import { SheetRenderer } from "./sheet-renderer"
import { resolveArtifactRendererKind } from "./resolve-renderer"
import { Spinner } from "@/components/spinner"

const PptxArtifactRenderer = React.lazy(async () => {
  const mod = await import("./pptx-artifact-renderer")
  return { default: mod.PptxArtifactRenderer }
})

const DocxArtifactRenderer = React.lazy(async () => {
  const mod = await import("./docx-artifact-renderer")
  return { default: mod.DocxArtifactRenderer }
})

const XlsxArtifactRenderer = React.lazy(async () => {
  const mod = await import("./xlsx-artifact-renderer")
  return { default: mod.XlsxArtifactRenderer }
})

function LazyArtifactPreview({
  children,
  loadingLabel,
}: {
  children: React.ReactNode
  loadingLabel: string
}) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          {loadingLabel}
        </div>
      }
    >
      {children}
    </React.Suspense>
  )
}

function PptxArtifactRendererSuspense({
  artifact,
  className,
}: {
  artifact: Artifact
  className?: string
}) {
  return (
    <LazyArtifactPreview loadingLabel="正在加载演示文稿预览…">
      <PptxArtifactRenderer artifact={artifact} className={className} />
    </LazyArtifactPreview>
  )
}

function DocxArtifactRendererSuspense({
  artifact,
  className,
}: {
  artifact: Artifact
  className?: string
}) {
  return (
    <LazyArtifactPreview loadingLabel="正在加载 Word 预览…">
      <DocxArtifactRenderer artifact={artifact} className={className} />
    </LazyArtifactPreview>
  )
}

function XlsxArtifactRendererSuspense({
  artifact,
  className,
}: {
  artifact: Artifact
  className?: string
}) {
  return (
    <LazyArtifactPreview loadingLabel="正在加载 Excel 预览…">
      <XlsxArtifactRenderer artifact={artifact} className={className} />
    </LazyArtifactPreview>
  )
}

export interface ArtifactRendererViewProps {
  artifact: Artifact
  filePath?: string | null
  conversationId?: string | number | null
  className?: string
}

export function ArtifactRendererView({
  artifact,
  filePath = null,
  conversationId = null,
  className,
}: ArtifactRendererViewProps) {
  const kind = resolveArtifactRendererKind(artifact, filePath)

  switch (kind) {
    case "markdown":
      return (
        <MarkdownArtifactRenderer
          artifact={artifact}
          className={className}
        />
      )
    case "html":
      return (
        <HtmlArtifactRenderer
          artifact={artifact}
          className={className}
          conversationId={conversationId}
          filePath={filePath}
        />
      )
    case "sheet":
      return <SheetRenderer artifact={artifact} className={className} />
    case "image":
      return <ImageRenderer artifact={artifact} className={className} />
    case "pptx":
      return (
        <PptxArtifactRendererSuspense
          artifact={artifact}
          className={className}
        />
      )
    case "legacy-ppt":
      return (
        <LegacyPptArtifactRenderer artifact={artifact} className={className} />
      )
    case "docx":
      return (
        <DocxArtifactRendererSuspense
          artifact={artifact}
          className={className}
        />
      )
    case "xlsx":
      return (
        <XlsxArtifactRendererSuspense
          artifact={artifact}
          className={className}
        />
      )
    case "legacy-doc":
      return (
        <LegacyOfficeArtifactRenderer
          artifact={artifact}
          format="doc"
          className={className}
        />
      )
    case "legacy-xls":
      return (
        <LegacyOfficeArtifactRenderer
          artifact={artifact}
          format="xls"
          className={className}
        />
      )
    case "document":
      return <DocViewerRenderer artifact={artifact} className={className} />
    case "code":
    default:
      return <CodeRenderer artifact={artifact} className={className} />
  }
}

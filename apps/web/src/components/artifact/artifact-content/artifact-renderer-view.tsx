import * as React from "react"
import type { Artifact } from "../artifact-types"
import { CodeRenderer } from "./code-renderer"
import { DocViewerRenderer } from "./doc-viewer-renderer"
import { HtmlArtifactRenderer } from "./html-artifact-renderer"
import { ImageRenderer } from "./image-renderer"
import { LegacyPptArtifactRenderer } from "./legacy-ppt-artifact-renderer"
import { MarkdownArtifactRenderer } from "./markdown-artifact-renderer"
import { SheetRenderer } from "./sheet-renderer"
import { resolveArtifactRendererKind } from "./resolve-renderer"
import { Spinner } from "@/components/spinner"

const PptxArtifactRenderer = React.lazy(async () => {
  const mod = await import("./pptx-artifact-renderer")
  return { default: mod.PptxArtifactRenderer }
})

function PptxArtifactRendererSuspense({
  artifact,
  className,
}: {
  artifact: Artifact
  className?: string
}) {
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          正在加载演示文稿预览…
        </div>
      }
    >
      <PptxArtifactRenderer artifact={artifact} className={className} />
    </React.Suspense>
  )
}

export interface ArtifactRendererViewProps {
  artifact: Artifact
  filePath?: string | null
  className?: string
}

export function ArtifactRendererView({
  artifact,
  filePath = null,
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
        <HtmlArtifactRenderer artifact={artifact} className={className} />
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
    case "document":
      return <DocViewerRenderer artifact={artifact} className={className} />
    case "code":
    default:
      return <CodeRenderer artifact={artifact} className={className} />
  }
}

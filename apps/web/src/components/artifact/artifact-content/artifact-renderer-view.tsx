import type { Artifact } from "../artifact-types"
import { CodeRenderer } from "./code-renderer"
import { DocViewerRenderer } from "./doc-viewer-renderer"
import { HtmlArtifactRenderer } from "./html-artifact-renderer"
import { ImageRenderer } from "./image-renderer"
import { MarkdownArtifactRenderer } from "./markdown-artifact-renderer"
import { SheetRenderer } from "./sheet-renderer"
import { resolveArtifactRendererKind } from "./resolve-renderer"

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
    case "document":
      return <DocViewerRenderer artifact={artifact} className={className} />
    case "code":
    default:
      return <CodeRenderer artifact={artifact} className={className} />
  }
}

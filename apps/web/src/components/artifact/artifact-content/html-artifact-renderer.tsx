import * as React from "react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CodeHighlight } from "@/components/chat/code-highlight"
import type { Artifact } from "../artifact-types"
import { HTML_PREVIEW_SANDBOX, wrapHtmlForPreview } from "./html-preview-utils"
import { PreviewSourceShell } from "./preview-source-shell"

export interface HtmlArtifactRendererProps {
  artifact: Artifact
  className?: string
}

const scrollClassName = cn(
  "min-h-0 min-w-0 flex-1 p-4",
  "[&_[data-slot=scroll-area-viewport]>div]:!block",
  "[&_[data-slot=scroll-area-viewport]>div]:!w-full",
  "[&_[data-slot=scroll-area-viewport]>div]:!min-w-0"
)

export const HtmlArtifactRenderer = ({
  artifact,
  className,
}: HtmlArtifactRendererProps) => {
  const srcDoc = React.useMemo(
    () => wrapHtmlForPreview(artifact.content),
    [artifact.content]
  )

  return (
    <PreviewSourceShell
      artifact={artifact}
      className={className}
      renderPreview={() => (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          <iframe
            title={artifact.title}
            sandbox={HTML_PREVIEW_SANDBOX}
            srcDoc={srcDoc}
            className="h-full w-full min-h-[200px] border-0 bg-white dark:bg-zinc-950"
          />
        </div>
      )}
      renderSource={() => (
        <ScrollArea className={scrollClassName}>
          <CodeHighlight
            className="w-full min-w-0 rounded-md border bg-muted/30"
            code={artifact.content}
            language="html"
          />
        </ScrollArea>
      )}
    />
  )
}

import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CodeHighlight } from "@/components/chat/code-highlight"
import type { Artifact } from "../artifact-types"
import { PreviewSourceShell } from "./preview-source-shell"

export interface MarkdownArtifactRendererProps {
  artifact: Artifact
  className?: string
}

const scrollClassName = cn(
  "min-h-0 min-w-0 flex-1 p-4",
  "[&_[data-slot=scroll-area-viewport]>div]:!block",
  "[&_[data-slot=scroll-area-viewport]>div]:!w-full",
  "[&_[data-slot=scroll-area-viewport]>div]:!min-w-0"
)

export const MarkdownArtifactRenderer = ({
  artifact,
  className,
}: MarkdownArtifactRendererProps) => {
  return (
    <PreviewSourceShell
      artifact={artifact}
      className={className}
      renderPreview={() => (
        <ScrollArea className={scrollClassName}>
          <MessageResponse className="min-w-0 text-sm">
            {artifact.content}
          </MessageResponse>
        </ScrollArea>
      )}
      renderSource={() => (
        <ScrollArea className={scrollClassName}>
          <CodeHighlight
            className="w-full min-w-0 rounded-md border bg-muted/30"
            code={artifact.content}
            language="markdown"
          />
        </ScrollArea>
      )}
    />
  )
}

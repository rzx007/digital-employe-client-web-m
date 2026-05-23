import { cn } from "@workspace/ui/lib/utils"
import { CodeHighlight, detectLanguage } from "@/components/chat/code-highlight"
import type { Artifact } from "../artifact-types"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

export interface TextRendererProps {
  artifact: Artifact
  className?: string
}

export const TextRenderer = ({ artifact, className }: TextRendererProps) => {
  const language = artifact.language || detectLanguage(artifact.title) || "text"

  return (
    <ScrollArea
      className={cn(
        "min-h-0 min-w-0 flex-1 p-4",
        "[&_[data-slot=scroll-area-viewport]>div]:!block",
        "[&_[data-slot=scroll-area-viewport]>div]:!w-full",
        "[&_[data-slot=scroll-area-viewport]>div]:!min-w-0",
        className
      )}
    >
      <CodeHighlight
        className="w-full min-w-0 rounded-md border bg-muted/30"
        code={artifact.content}
        language={language}
      />
    </ScrollArea>
  )
}

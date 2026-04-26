import { cn } from "@workspace/ui/lib/utils"
import { CodeHighlight, detectLanguage } from "@/components/chat/code-highlight"
import type { Artifact } from "../artifact-types"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

export interface CodeRendererProps {
  artifact: Artifact
  className?: string
}

export const CodeRenderer = ({ artifact, className }: CodeRendererProps) => {
  const language = artifact.language || detectLanguage(artifact.title) || "text"

  return (
    <ScrollArea className={cn("min-h-0 min-w-0 flex-1 overflow-auto p-4", className)}>
      <CodeHighlight
        className="min-w-0 overflow-x-auto rounded-md border bg-muted/30"
        code={artifact.content}
        language={language}
      />
    </ScrollArea>
  )
}

import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

export interface CodeRendererProps {
  artifact: Artifact
  className?: string
}

export const CodeRenderer = ({ artifact, className }: CodeRendererProps) => {
  const language = artifact.language || "text"

  return (
    <ScrollArea className={cn("flex-1 overflow-auto p-4", className)}>
      <MessageResponse>
        {`\`\`\`${language}\n${artifact.content}\n\`\`\``}
      </MessageResponse>
    </ScrollArea>
  )
}

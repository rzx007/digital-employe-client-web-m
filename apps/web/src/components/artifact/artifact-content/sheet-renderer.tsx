import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

export interface SheetRendererProps {
  artifact: Artifact
  className?: string
}

export const SheetRenderer = ({ artifact, className }: SheetRendererProps) => {
  return (
    <ScrollArea className={cn("min-h-0 min-w-0 flex-1 overflow-auto p-4", className)}>
      <MessageResponse className="min-w-0 overflow-x-auto">
        {artifact.content}
      </MessageResponse>
    </ScrollArea>
  )
}

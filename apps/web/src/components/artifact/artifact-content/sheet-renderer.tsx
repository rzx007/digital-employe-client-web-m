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
    <ScrollArea className={cn("flex-1 overflow-auto p-4", className)}>
      <MessageResponse>{artifact.content}</MessageResponse>
    </ScrollArea>
  )
}

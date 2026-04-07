import { cn } from "@workspace/ui/lib/utils"
import type { Artifact } from "../artifact-types"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

export interface ImageRendererProps {
  artifact: Artifact
  className?: string
}

export const ImageRenderer = ({ artifact, className }: ImageRendererProps) => {
  const isDataUrl = artifact.content.startsWith("data:")

  return (
    <ScrollArea
      className={cn(
        "flex flex-1 items-center justify-center overflow-auto bg-background p-4",
        className
      )}
    >
      {isDataUrl ? (
        <img
          src={artifact.content}
          alt={artifact.title}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <p className="text-sm">{artifact.content}</p>
          <p className="text-xs">（外部链接，请点击查看）</p>
        </div>
      )}
    </ScrollArea>
  )
}

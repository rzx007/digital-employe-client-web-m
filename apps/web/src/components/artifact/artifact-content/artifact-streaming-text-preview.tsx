import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { IconLoader } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"

export interface ArtifactStreamingTextPreviewProps {
  content: string
  className?: string
}

/** 流式写入阶段的轻量预览：纯文本，不做语法高亮 / Markdown 解析 */
export function ArtifactStreamingTextPreview({
  content,
  className,
}: ArtifactStreamingTextPreviewProps) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}>
      <ScrollArea
        className={cn(
          "min-h-0 min-w-0 flex-1 p-4",
          "[&_[data-slot=scroll-area-viewport]>div]:block!",
          "[&_[data-slot=scroll-area-viewport]>div]:w-full!",
          "[&_[data-slot=scroll-area-viewport]>div]:min-w-0!"
        )}
      >
        <pre className="m-0 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
          {content}
        </pre>
      </ScrollArea>
      <div className="flex shrink-0 items-center gap-1.5 border-t px-4 py-2 text-[11px] text-muted-foreground">
        <IconLoader className="size-3 animate-spin" />
        写入中…
      </div>
    </div>
  )
}

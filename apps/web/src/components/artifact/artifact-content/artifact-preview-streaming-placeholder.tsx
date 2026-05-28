import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

import type { ArtifactRendererKind } from "@/lib/chat/pending-resources/preview-streaming"

export interface ArtifactPreviewStreamingPlaceholderProps {
  kind: ArtifactRendererKind
  className?: string
}

function getCopy(kind: ArtifactRendererKind) {
  switch (kind) {
    case "html":
      return {
        title: "HTML 生成中",
        description: "页面结构将在写入完成后预览，避免渲染不完整标记",
      }
    case "document":
      return {
        title: "文件写入中",
        description: "Office / PDF 等文档需落盘后才能预览",
      }
    case "image":
      return {
        title: "图片生成中",
        description: "图片落盘后将在此显示预览",
      }
    case "sheet":
      return {
        title: "表格生成中",
        description: "表格文件完成后将在此预览",
      }
    default:
      return {
        title: "文件写入中",
        description: "内容将随工具输出更新",
      }
  }
}

function HtmlPageSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-6">
      <Skeleton className="h-8 w-2/5 max-w-xs" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Skeleton className="h-32 w-full rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  )
}

function DefaultSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-6">
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <Skeleton className="min-h-[12rem] w-full flex-1 rounded-lg" />
    </div>
  )
}

export function ArtifactPreviewStreamingPlaceholder({
  kind,
  className,
}: ArtifactPreviewStreamingPlaceholderProps) {
  const copy = getCopy(kind)

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background",
        className
      )}
    >
      <div className="border-b px-4 py-3">
        <p className="text-sm font-medium text-foreground">{copy.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {copy.description}
        </p>
      </div>
      {kind === "html" ? <HtmlPageSkeleton /> : <DefaultSkeleton />}
    </div>
  )
}

import { IconDownload } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { downloadResource } from "@/api/chat"
import type { Artifact } from "../artifact-types"

export interface LegacyPptArtifactRendererProps {
  artifact: Artifact
  className?: string
}

/** 旧版 .ppt 二进制格式无法在浏览器内可靠预览，提供说明与下载 */
export function LegacyPptArtifactRenderer({
  artifact,
  className,
}: LegacyPptArtifactRendererProps) {
  const conversationId = artifact.metadata?.conversationId as
    | string
    | number
    | undefined
  const resourcePath = artifact.metadata?.resourcePath as string | undefined
  const filename = resourcePath?.split("/").pop() ?? "presentation.ppt"

  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center",
        className
      )}
    >
      <p className="text-sm font-medium text-foreground/80">
        暂不支持在线预览旧版 .ppt 文件
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        桌面端资源为本地文件，无法使用 Microsoft Office 在线预览服务。请将{" "}
        <span className="font-mono text-foreground/70">{filename}</span>{" "}
        下载后用 PowerPoint 或 WPS 打开；若需在线预览，可让 AI 另存为 .pptx。
      </p>
      {conversationId && resourcePath ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void downloadResource(conversationId, resourcePath)}
        >
          <IconDownload className="size-4" />
          下载文件
        </Button>
      ) : null}
    </div>
  )
}

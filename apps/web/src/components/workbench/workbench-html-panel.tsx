import * as React from "react"
import { IconRefresh, IconAlertTriangle } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useResourceContentQuery } from "@/hooks/use-chat-queries"
import {
  HTML_PREVIEW_SANDBOX,
  wrapHtmlForPreview,
} from "@/components/artifact/artifact-content/html-preview-utils"
import type { HtmlArtifactRef } from "@/types/workbench"

interface WorkbenchHtmlPanelProps {
  htmlRef: HtmlArtifactRef
  title: string
  className?: string
}

/**
 * 工作台单看板：取总管生成的 HTML 源码 → 直接渲染到沙箱 iframe（iframe 内 JS 自带 fetch
 * 实时拉数据出图）。与资源面板不同，工作台看板**只展示渲染结果**，不需要「预览/源码」切换，
 * 故不走带 PreviewSourceShell 的 HtmlArtifactRenderer，直接用同一套 wrap + sandbox（递归
 * 修复仍生效）。源文件缺失时渲染占位，不崩溃。
 */
export function WorkbenchHtmlPanel({
  htmlRef,
  title,
  className,
}: WorkbenchHtmlPanelProps) {
  const { data, isLoading, isError, refetch } = useResourceContentQuery(
    htmlRef.conversationId,
    htmlRef.resourcePath
  )

  const srcDoc = React.useMemo(() => {
    if (!data?.content) return null
    return wrapHtmlForPreview(data.content)
  }, [data?.content])

  const missing = isError || (!isLoading && !data?.content)

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-md border border-border/80 bg-card shadow-sm",
        className
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/35 px-2 py-1">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title="刷新看板"
          onClick={() => void refetch()}
        >
          <IconRefresh className="size-3" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {missing ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
            <IconAlertTriangle className="size-5 text-muted-foreground/70" />
            <p className="text-xs text-muted-foreground">
              产物已不存在或无法加载
            </p>
            <p className="text-[10px] text-muted-foreground/80">
              可移除此看板，或在总管会话重新生成
            </p>
          </div>
        ) : srcDoc ? (
          <iframe
            title={title}
            sandbox={HTML_PREVIEW_SANDBOX}
            srcDoc={srcDoc}
            className="h-full w-full border-0 bg-white dark:bg-zinc-950"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            加载中…
          </div>
        )}
      </div>
    </div>
  )
}

import * as React from "react"
import { createPortal } from "react-dom"
import {
  IconRefresh,
  IconAlertTriangle,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkbenchHtmlContentQuery } from "@/hooks/use-chat-queries"
import { getRequestBaseUrl } from "@/lib/request"
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
  // 内容来源：资源池（带 resourceId）走资源内容端点，否则走会话内资源端点。
  // 两个分支封装在 useWorkbenchHtmlContentQuery 内部，便于测试只 mock 一个钩子。
  const { data, isLoading, isError, refetch } =
    useWorkbenchHtmlContentQuery(htmlRef)

  const [isFullscreen, setIsFullscreen] = React.useState(false)
  // 刷新计数：点刷新时 ++，作为 iframe key 的一部分强制重载（即使新旧 srcDoc 字符串相同，
  // 沙箱 iframe 也未必自动重渲染；换 key 强制重挂）。
  const [reloadNonce, setReloadNonce] = React.useState(0)
  const handleRefresh = React.useCallback(() => {
    void refetch()
    setReloadNonce((n) => n + 1)
  }, [refetch])

  const content = data?.content
  const srcDoc = React.useMemo(() => {
    if (!content) return null
    // 注入中性 base（防相对引用递归）+ 运行时代理拦截脚本（外部 fetch/XHR 走后端 /proxy 绕 CORS）。
    // hideScrollbar：看板格子固定高度，内容超高时隐藏 iframe 内滚动条（仍可滚），避免露丑。
    return wrapHtmlForPreview(content, getRequestBaseUrl(), { hideScrollbar: true })
  }, [content])

  const missing = isError || (!isLoading && !content)

  // 全屏时按 Escape 退出
  React.useEffect(() => {
    if (!isFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isFullscreen])

  const panelBody = (
    <div
      className={cn(
        "flex flex-col overflow-hidden border border-border/80 bg-card shadow-sm",
        isFullscreen
          ? // 全屏经 Portal 挂到 document.body：fixed 相对视口生效（不被 dnd-kit 的
            // transform/isolate 祖先困住），z 足够高盖住总管栏/资源面板等
            "fixed inset-0 z-[100] h-screen w-screen rounded-none"
          : "h-full rounded-md",
        className
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-border/50 bg-muted/35 px-2 py-1",
          // 非全屏时网格层的「删除」按钮（hover 浮于右上角 right-2，约 40px 宽）会盖到本栏
          // 右侧，预留右内边距让刷新/全屏按钮左移，避开删除按钮
          !isFullscreen && "pr-10"
        )}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {title}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title="刷新看板"
          onClick={handleRefresh}
        >
          <IconRefresh className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-5"
          title={isFullscreen ? "退出全屏 (Esc)" : "全屏"}
          onClick={() => setIsFullscreen((v) => !v)}
        >
          {isFullscreen ? (
            <IconMinimize className="size-3" />
          ) : (
            <IconMaximize className="size-3" />
          )}
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
            key={reloadNonce}
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

  // 全屏时 Portal 到 body，避开 dnd-kit 网格祖先的 transform/isolate 对 fixed 的束缚；
  // 非全屏时占位（保持原网格槽位尺寸不塌陷）
  if (isFullscreen) {
    return (
      <>
        <div className={cn("h-full rounded-md", className)} aria-hidden />
        {createPortal(panelBody, document.body)}
      </>
    )
  }

  return panelBody
}

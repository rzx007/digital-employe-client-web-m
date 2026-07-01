import * as React from "react"
import { IconExternalLink } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CodeHighlight } from "@/components/chat/code-highlight"
import { useBrowserStore } from "@/stores/browser-store"
import type { Artifact } from "../artifact-types"
import { HTML_PREVIEW_SANDBOX, wrapHtmlForPreview } from "./html-preview-utils"
import { PreviewSourceShell } from "./preview-source-shell"

export interface HtmlArtifactRendererProps {
  artifact: Artifact
  className?: string
  conversationId?: string | number | null
  filePath?: string | null
}

/**
 * 仅当同时拥有会话 ID 与虚拟文件路径时，才展示「在浏览器打开」按钮。
 * 抽成纯函数便于单测。
 */
export function shouldShowOpenInBrowser(
  conversationId: string | number | null | undefined,
  filePath: string | null | undefined
): conversationId is string | number {
  return conversationId != null && Boolean(filePath)
}

const scrollClassName = cn(
  "min-h-0 min-w-0 flex-1 p-4",
  "[&_[data-slot=scroll-area-viewport]>div]:!block",
  "[&_[data-slot=scroll-area-viewport]>div]:!w-full",
  "[&_[data-slot=scroll-area-viewport]>div]:!min-w-0"
)

export const HtmlArtifactRenderer = ({
  artifact,
  className,
  conversationId = null,
  filePath = null,
}: HtmlArtifactRendererProps) => {
  const openHtmlPreview = useBrowserStore((s) => s.openHtmlPreview)
  const srcDoc = React.useMemo(
    () => wrapHtmlForPreview(artifact.content),
    [artifact.content]
  )

  const headerActions = shouldShowOpenInBrowser(conversationId, filePath) ? (
    <Button
      size="sm"
      variant="ghost"
      title="在浏览器打开"
      onClick={() => openHtmlPreview(conversationId, filePath as string)}
    >
      <IconExternalLink />
      在浏览器打开
    </Button>
  ) : undefined

  return (
    <PreviewSourceShell
      artifact={artifact}
      className={className}
      headerActions={headerActions}
      renderPreview={() => (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
          <iframe
            title={artifact.title}
            sandbox={HTML_PREVIEW_SANDBOX}
            srcDoc={srcDoc}
            className="h-full w-full min-h-[200px] border-0 bg-white dark:bg-zinc-950"
          />
        </div>
      )}
      renderSource={() => (
        <ScrollArea className={scrollClassName}>
          <CodeHighlight
            className="w-full min-w-0 rounded-md border bg-muted/30"
            code={artifact.content}
            language="html"
          />
        </ScrollArea>
      )}
    />
  )
}

import * as React from "react"

import { cn } from "@workspace/ui/lib/utils"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"

import { useCuratorFile } from "@/components/chat/curator/use-curator-file"
import { getFileIcon } from "@/lib/chat/file-icons"
import {
  basenameOfPath,
  linkifyArtifactPaths,
} from "@/lib/chat/linkify-artifact-paths"
import { isArtifactLikePath } from "@/lib/chat/pending-resources/paths"
import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useChatStore } from "@/stores/chat-store"
import { resolveFileOpen } from "./file-open-routing"

/** 行内可点的产物芯片：显示文件名 + 图标，点击在右侧面板打开（.html 走预览） */
export function ArtifactPathChip({
  path,
  label,
  onOpen,
}: {
  path: string
  label: React.ReactNode
  onOpen: (path: string) => void
}) {
  const display =
    typeof label === "string" && label.trim() ? label : basenameOfPath(path)
  return (
    <button
      type="button"
      title={path}
      onClick={() => onOpen(path)}
      className={cn(
        "not-prose mx-0.5 inline-flex max-w-full cursor-pointer items-baseline gap-1",
        "rounded-md border border-border/60 bg-muted/50 px-1.5 py-0 align-middle",
        "text-[0.95em] leading-snug text-foreground no-underline",
        "transition-colors hover:border-border hover:bg-muted"
      )}
    >
      <img
        src={getFileIcon(path)}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="size-3.5 shrink-0 self-center"
      />
      <span className="min-w-0 truncate">{display}</span>
    </button>
  )
}

interface AnchorProps {
  href?: string
  children?: React.ReactNode
  onOpen: (path: string) => void
  [key: string]: unknown
}

/** Streamdown 的 `a` 覆写：产物路径→芯片，其余→普通外链 */
function ArtifactAnchor({
  href,
  children,
  onOpen,
  node: _node,
  ...rest
}: AnchorProps) {
  const path = typeof href === "string" ? href : ""
  if (path && isArtifactLikePath(path)) {
    return <ArtifactPathChip path={path} label={children} onOpen={onOpen} />
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  )
}

/**
 * 最终回复正文渲染：在 markdown 渲染前把裸露的产物路径包装成链接，
 * 再用自定义 `a` 组件把这些链接渲染成行内可点芯片。
 */
export function FinalResponseContent({
  text,
  conversationId,
  className,
}: {
  text: string
  conversationId?: string | number | null
  className?: string
}) {
  const curatorFile = useCuratorFile()
  const openResource = useArtifactStore((s) => s.openResource)
  const openHtmlPreview = useBrowserStore((s) => s.openHtmlPreview)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)

  const curatorOnOpenFile = curatorFile?.onOpenFile
  const effectiveConversationId =
    curatorFile?.conversationId ?? conversationId ?? selectedConversationId

  const handleOpen = React.useCallback(
    (path: string) => {
      if (curatorOnOpenFile) {
        curatorOnOpenFile(path)
        return
      }
      resolveFileOpen(path, {
        conversationId: effectiveConversationId,
        openHtmlPreview,
        openResource,
      })
    },
    [curatorOnOpenFile, effectiveConversationId, openHtmlPreview, openResource]
  )

  const linkified = React.useMemo(() => linkifyArtifactPaths(text), [text])

  const components = React.useMemo(
    () => ({
      a: (props: AnchorProps) => (
        <ArtifactAnchor {...props} onOpen={handleOpen} />
      ),
    }),
    [handleOpen]
  )

  return (
    <MessageResponse className={className} components={components}>
      {linkified}
    </MessageResponse>
  )
}

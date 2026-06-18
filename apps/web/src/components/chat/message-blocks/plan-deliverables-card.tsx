"use client"

import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import type { OrchestrationDeliverable } from "@/api/orchestration"
import { useCuratorFile } from "@/components/chat/curator/use-curator-file"
import { categorizeArtifactPath } from "@/lib/chat/file-change-utils"
import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useChatStore } from "@/stores/chat-store"
import { ArtifactPathChip } from "./artifact-path-chip"
import { resolveFileOpen } from "./file-open-routing"

/**
 * 「团队交付物」聚合卡（#子任务产物回流主对话）：计划完成后汇总各子任务产出的
 * 文件，交付物显眼、中间产物折叠计数。点击芯片在右侧面板打开（.html 走预览）。
 */
export function PlanDeliverablesCard({
  artifacts,
  conversationId,
  className,
}: {
  artifacts: OrchestrationDeliverable[]
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

  const { deliverables, intermediates } = React.useMemo(() => {
    const d: OrchestrationDeliverable[] = []
    const i: OrchestrationDeliverable[] = []
    for (const a of artifacts) {
      ;(categorizeArtifactPath(a.path) === "deliverable" ? d : i).push(a)
    }
    return { deliverables: d, intermediates: i }
  }, [artifacts])

  const [showIntermediate, setShowIntermediate] = React.useState(false)

  if (artifacts.length === 0) return null

  return (
    <div className={cn("rounded-lg border border-border/60 bg-muted/20 p-3", className)}>
      <p className="mb-2 text-xs font-medium text-muted-foreground">团队交付物</p>
      <div className="flex flex-wrap gap-1.5">
        {(deliverables.length > 0 ? deliverables : intermediates).map((a) => (
          <ArtifactPathChip
            key={`${a.task_id}:${a.path}`}
            path={a.path}
            label={a.basename}
            onOpen={handleOpen}
          />
        ))}
      </div>
      {deliverables.length > 0 && intermediates.length > 0 ? (
        <div className="mt-2">
          {showIntermediate ? (
            <div className="flex flex-wrap gap-1.5">
              {intermediates.map((a) => (
                <ArtifactPathChip
                  key={`${a.task_id}:${a.path}`}
                  path={a.path}
                  label={a.basename}
                  onOpen={handleOpen}
                />
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="text-[11px] text-muted-foreground hover:underline"
              onClick={() => setShowIntermediate(true)}
            >
              +{intermediates.length} 个中间产物（脚本/依赖）
            </button>
          )}
        </div>
      ) : null}
    </div>
  )
}

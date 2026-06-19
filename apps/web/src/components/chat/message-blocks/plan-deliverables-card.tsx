"use client"

import * as React from "react"
import type { OrchestrationDeliverable } from "@/api/orchestration"
import {
  categorizeArtifactPath,
  type FileChangeItem,
} from "@/lib/chat/file-change-utils"
import { FileChangeCards } from "./file-change-cards"

function extensionOf(basename: string): string | undefined {
  const dot = basename.lastIndexOf(".")
  if (dot <= 0 || dot === basename.length - 1) return undefined
  return basename.slice(dot + 1).toLowerCase()
}

/**
 * 「团队交付物」聚合卡（#子任务产物回流主对话）：把计划各子任务产出的文件映射成
 * FileChangeItem，复用与员工会话同一套 FileChangeCards 视觉（图标/已创建/路径/大小/
 * 下载、交付物与脚本分区），仅头部标签改为「团队交付物」。
 */
export function PlanDeliverablesCard({
  artifacts,
  className,
}: {
  artifacts: OrchestrationDeliverable[]
  conversationId?: string | number | null
  className?: string
}) {
  const files: FileChangeItem[] = React.useMemo(
    () =>
      artifacts.map((a) => ({
        id: `deliverable:${a.task_id}:${a.path}`,
        kind: "file",
        category: categorizeArtifactPath(a.path),
        action: a.action === "edited" ? "edited" : "created",
        title: a.basename,
        path: a.path,
        extension: extensionOf(a.basename),
        size: a.size ?? undefined,
        toolCallId: String(a.task_id),
      })),
    [artifacts]
  )

  if (files.length === 0) return null

  return (
    <FileChangeCards files={files} title="团队交付物" className={className} />
  )
}

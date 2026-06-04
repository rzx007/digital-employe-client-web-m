import * as React from "react"

import { useQuery } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

import { fetchRoomArtifact } from "@/api/group-room"

/**
 * 群产物文件预览弹窗：点 DAG 节点上的文件 → 弹窗渲染内容（md 表格等）。
 * 用户只看到文件名与内容，不暴露内部路径。
 */
export function GroupArtifactDialog({
  conversationId,
  path,
  open,
  onOpenChange,
}: {
  conversationId: string | number
  path: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["group-room-artifact", String(conversationId), path ?? ""],
    queryFn: ({ signal }) =>
      fetchRoomArtifact(conversationId, path!, { signal }),
    enabled: open && Boolean(path),
    staleTime: 30_000,
  })

  const title = data?.name ?? (path ? path.split("/").pop() : "文件预览")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-5xl flex-col sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span aria-hidden>📄</span>
            <span className="truncate">{title}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/20">
          {isPending ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              加载中…
            </p>
          ) : isError || !data ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              无法读取该文件
            </p>
          ) : data.is_text ? (
            <MessageResponse className="min-w-0 p-4 text-sm">
              {data.content}
            </MessageResponse>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">
              该文件类型（{data.type || "未知"}）暂不支持预览
            </p>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

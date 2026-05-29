"use client"

import * as React from "react"
import { memo, useState } from "react"
import { IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { approveHitl, type HitlDecision } from "@/api/chat"
import {
  isHitlAbortedOutput,
  isValidApproveMessageId,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"
import { buildDestructiveDeletePreview } from "@/lib/chat/destructive-delete-payload"

function DestructiveDeleteConfirmCardInner({
  toolName,
  input,
  state,
  resultText,
  conversationId,
  messageId,
  onHitlApproved,
  className,
}: {
  toolName: string
  input: unknown
  state?: string
  resultText?: string | null
  conversationId?: string | number | null
  messageId?: string | number | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
  className?: string
}) {
  const [submitting, setSubmitting] = useState(false)
  const [resolved, setResolved] = useState(false)

  const preview = React.useMemo(
    () => buildDestructiveDeletePreview(toolName, input),
    [toolName, input]
  )

  const isAborted = isHitlAbortedOutput(resultText ?? undefined)
  const isInputStreaming = state === "input-streaming" || state === "call"
  const isGenerating = !resolved && !isAborted && isInputStreaming
  const isPending =
    !resolved && !isAborted && state === "input-available"
  const isConfirmed = !isAborted && state === "output-available"

  const submitDecisions = async (
    decisions: HitlDecision[],
    skipForConversation = false
  ) => {
    if (!isValidApproveMessageId(messageId)) {
      toast.error("无法确认：缺少有效的消息 ID，请刷新后重试")
      return
    }
    if (!conversationId) {
      toast.error("无法确认：缺少 conversationId")
      return
    }
    if (isAborted) {
      toast.error("本轮已中止，请重新发送消息")
      return
    }
    if (state !== "input-available") {
      toast.error("当前状态不可操作，请稍候")
      return
    }
    if (submitting || resolved) return

    setSubmitting(true)
    try {
      const res = await approveHitl(conversationId, messageId, decisions, {
        destructive_hitl: skipForConversation
          ? { skip_for_conversation: true }
          : undefined,
      })
      setResolved(true)
      onHitlApproved?.({
        kind: "destructive-delete",
        approvedMessageId: messageId,
        resumed: res.data?.resumed,
        assistantMessageId: res.data?.assistant_message_id,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "确认失败，请重试")
    } finally {
      setSubmitting(false)
    }
  }

  if (!preview && !isGenerating) return null

  const actionTitle = preview?.title ?? "删除操作"
  const detailLines = preview?.detailLines ?? []

  const headerLabel = isAborted
    ? "删除已取消"
    : isConfirmed
      ? "删除已确认"
      : isGenerating
        ? "准备删除参数…"
        : "删除待确认"

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-xs font-semibold",
              isAborted
                ? "text-muted-foreground"
                : isConfirmed
                  ? "text-foreground"
                  : "text-amber-700 dark:text-amber-400"
            )}
          >
            {headerLabel}
          </p>
          {preview && (
            <p className="mt-0.5 text-sm leading-snug font-medium">
              {actionTitle}
            </p>
          )}
        </div>
        {isGenerating && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            生成中
          </span>
        )}
        {isPending && (
          <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
            待确认
          </span>
        )}
        {isAborted && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            已取消
          </span>
        )}
      </div>

      {detailLines.length > 0 && (
        <ul className="space-y-0.5 rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
          {detailLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      {isPending && (
        <>
          <p className="text-muted-foreground mt-2 text-[10px]">
            确认后将立即执行，且无法撤销。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() => submitDecisions([{ type: "approve" }])}
            >
              {submitting ? "提交中..." : "确认删除"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() =>
                submitDecisions([
                  { type: "reject", message: "用户取消删除" },
                ])
              }
            >
              <IconX className="mr-1 size-3" />
              取消
            </Button>
          </div>
          <button
            type="button"
            disabled={submitting}
            className="text-muted-foreground mt-2 text-[11px] underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50"
            onClick={() => submitDecisions([{ type: "approve" }], true)}
          >
            本会话不再询问
          </button>
          <p className="text-muted-foreground mt-1 text-[10px]">
            适用于当前总管对话内的所有删除员工/任务操作；新建或清空对话后将恢复确认。
          </p>
        </>
      )}

      {isConfirmed && (
        <p className="text-muted-foreground text-xs">已确认，正在执行删除…</p>
      )}

      {isAborted && (
        <p className="text-muted-foreground text-xs">已取消或中止。</p>
      )}
    </div>
  )
}

export const DestructiveDeleteConfirmCard = memo(DestructiveDeleteConfirmCardInner)

"use client"

import * as React from "react"
import { memo, useState } from "react"
import { IconX } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { toast } from "sonner"
import { approveHitl, type HitlDecision } from "@/api/chat"
import {
  isValidApproveMessageId,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"

const EXTERNAL_DIR_REJECT_MESSAGE = "用户拒绝授权"

type ExternalDirScope = "once" | "session" | "permanent" | "auto"

function ExternalDirAuthCardInner({
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

  const path =
    input != null &&
    typeof input === "object" &&
    "path" in (input as Record<string, unknown>)
      ? String((input as Record<string, unknown>).path ?? "")
      : ""

  const isRejected =
    resultText != null &&
    (resultText.includes("拒绝") || resultText.includes("已中止") || resultText.includes("已取消"))
  const isInputStreaming = state === "input-streaming" || state === "call"
  const isGenerating = !resolved && !isRejected && isInputStreaming
  const isPending = !resolved && !isRejected && state === "input-available"
  const isConfirmed = !isRejected && state === "output-available"
  const canApprove = isValidApproveMessageId(messageId)

  const submitDecisions = async (
    decisions: HitlDecision[],
    scope?: ExternalDirScope
  ) => {
    if (!isValidApproveMessageId(messageId)) {
      toast.error("无法确认：缺少有效的消息 ID，请刷新后重试")
      return
    }
    if (!conversationId) {
      toast.error("无法确认：缺少 conversationId")
      return
    }
    if (isRejected) {
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
      const res = await approveHitl(
        conversationId,
        messageId,
        decisions,
        scope != null ? { external_dir: { path, scope } } : undefined
      )
      setResolved(true)
      onHitlApproved?.({
        kind: "external_dir_authorization",
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

  const headerLabel = isRejected
    ? "授权已拒绝"
    : isConfirmed
      ? "授权已确认"
      : isGenerating
        ? "准备授权参数…"
        : "目录写入授权"

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
              isRejected
                ? "text-muted-foreground"
                : isConfirmed
                  ? "text-foreground"
                  : "text-amber-700 dark:text-amber-400"
            )}
          >
            {headerLabel}
          </p>
          <p className="mt-0.5 text-sm leading-snug font-medium">
            员工想写入工作区外目录
          </p>
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
        {isRejected && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            已拒绝
          </span>
        )}
      </div>

      {path && (
        <div className="rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">目标路径：</span>
          <span className="break-all font-mono">{path}</span>
        </div>
      )}

      {isPending && (
        <>
          {!canApprove && (
            <p className="text-muted-foreground mt-2 text-[10px]">
              等待消息同步，请稍候再确认…
            </p>
          )}
          <p className="text-muted-foreground mt-2 text-[10px]">
            请选择授权范围：
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={submitting || !canApprove}
              onClick={() => submitDecisions([{ type: "approve" }], "once")}
            >
              {submitting ? "提交中..." : "仅这次"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={submitting || !canApprove}
              onClick={() => submitDecisions([{ type: "approve" }], "session")}
            >
              本会话
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={submitting || !canApprove}
              onClick={() =>
                submitDecisions([{ type: "approve" }], "permanent")
              }
            >
              永久
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={submitting || !canApprove}
              onClick={() => submitDecisions([{ type: "approve" }], "auto")}
            >
              放行所有(本会话)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={submitting || !canApprove}
              onClick={() =>
                submitDecisions([
                  { type: "reject", message: EXTERNAL_DIR_REJECT_MESSAGE },
                ])
              }
            >
              <IconX className="mr-1 size-3" />
              拒绝
            </Button>
          </div>
        </>
      )}

      {isConfirmed && (
        <p className="text-muted-foreground mt-2 text-xs">已授权，操作继续执行…</p>
      )}

      {isRejected && (
        <p className="text-muted-foreground mt-2 text-xs">已拒绝，员工将收到拒绝通知。</p>
      )}
    </div>
  )
}

export const ExternalDirAuthCard = memo(ExternalDirAuthCardInner)

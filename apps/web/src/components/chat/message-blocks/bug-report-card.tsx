"use client"

import * as React from "react"
import { memo, useState, useRef, useCallback } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Input } from "@workspace/ui/components/input"
import { Switch } from "@workspace/ui/components/switch"
import { Label } from "@workspace/ui/components/label"
import { toast } from "sonner"
import { approveHitl, type HitlDecision } from "@/api/chat"
import { isValidApproveMessageId } from "@/lib/chat/hitl"
import {
  isHitlAbortedOutput,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"

const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024

interface BugReportInput {
  title?: string
  description?: string
  repro_steps?: string
  expected?: string
  actual?: string
  include_logs?: boolean
  screenshot?: string
}

function BugReportCardInner({
  input,
  state,
  resultText,
  conversationId,
  messageId,
  toolCallId,
  onHitlApproved,
  className,
}: {
  input: unknown
  state?: string
  resultText?: string | null
  conversationId?: string | number | null
  messageId?: string | number | null
  toolCallId?: string
  onHitlApproved?: (options?: HitlPatchOptions) => void
  className?: string
}) {
  const [mode, setMode] = useState<"view" | "edit" | "reject">("view")
  const [submitting, setSubmitting] = useState(false)
  const [resolved, setResolved] = useState(false)
  const [rejectMessage, setRejectMessage] = useState("")

  const data = React.useMemo((): BugReportInput | null => {
    if (!input || typeof input !== "object") return null
    return input as BugReportInput
  }, [input])

  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editReproSteps, setEditReproSteps] = useState("")
  const [editExpected, setEditExpected] = useState("")
  const [editActual, setEditActual] = useState("")
  const [editIncludeLogs, setEditIncludeLogs] = useState(false)
  const [editScreenshot, setEditScreenshot] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!data) return null

  const isAborted = isHitlAbortedOutput(resultText ?? undefined)
  const isInputStreaming = state === "input-streaming" || state === "call"
  const isGenerating = !resolved && !isAborted && isInputStreaming
  const isPending = !resolved && !isAborted && state === "input-available"
  const isConfirmed = !isAborted && state === "output-available"

  const submitDecisions = async (decisions: HitlDecision[]) => {
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
      toast.error("反馈表单仍在生成，请稍候")
      return
    }
    if (submitting || resolved) return
    setSubmitting(true)
    try {
      const res = await approveHitl(conversationId, messageId, decisions)
      if (res?.code && res.code !== 200) {
        toast.error(res.msg || "确认失败")
        return
      }
      onHitlApproved?.({
        kind: "bug-report",
        toolCallId,
        approvedMessageId: messageId,
        resumed: true,
        assistantMessageId: res?.data?.assistant_message_id,
      })
      setResolved(true)
      setMode("view")
    } catch {
      toast.error("确认请求失败")
    } finally {
      setSubmitting(false)
    }
  }

  const hasEdits = (): boolean => {
    if (editScreenshot !== null) return true
    if (editTitle !== (data.title ?? "")) return true
    if (editDescription !== (data.description ?? "")) return true
    if (editReproSteps !== (data.repro_steps ?? "")) return true
    if (editExpected !== (data.expected ?? "")) return true
    if (editActual !== (data.actual ?? "")) return true
    if (editIncludeLogs !== Boolean(data.include_logs)) return true
    return false
  }

  const handleApprove = () => {
    if (mode === "edit" && hasEdits()) {
      void submitDecisions([
        {
          type: "edit",
          edited_action: {
            name: "submit_bug_report",
            args: {
              title: editTitle,
              description: editDescription,
              repro_steps: editReproSteps,
              expected: editExpected,
              actual: editActual,
              include_logs: editIncludeLogs,
              ...(editScreenshot !== null ? { screenshot: editScreenshot } : {}),
            },
          },
        },
      ])
    } else {
      void submitDecisions([{ type: "approve" }])
    }
  }

  const enterEditMode = () => {
    setEditTitle(data.title ?? "")
    setEditDescription(data.description ?? "")
    setEditReproSteps(data.repro_steps ?? "")
    setEditExpected(data.expected ?? "")
    setEditActual(data.actual ?? "")
    setEditIncludeLogs(Boolean(data.include_logs))
    setEditScreenshot(null)
    setMode("edit")
  }

  const handleReject = () => {
    const msg = rejectMessage.trim()
    if (!msg) {
      toast.error("请填写退回原因")
      return
    }
    void submitDecisions([{ type: "reject", message: msg }])
    setMode("view")
  }

  const handleEditSubmit = () => {
    void submitDecisions([
      {
        type: "edit",
        edited_action: {
          name: "submit_bug_report",
          args: {
            title: editTitle,
            description: editDescription,
            repro_steps: editReproSteps,
            expected: editExpected,
            actual: editActual,
            include_logs: editIncludeLogs,
            ...(editScreenshot !== null ? { screenshot: editScreenshot } : {}),
          },
        },
      },
    ])
    setMode("view")
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handleScreenshotFile = useCallback((file: File) => {
    if (file.size > MAX_SCREENSHOT_BYTES) {
      toast.error("截图过大（>2MB），请压缩后再上传")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const result = e.target?.result
      if (typeof result === "string") {
        setEditScreenshot(result)
      }
    }
    reader.readAsDataURL(file)
  }, [])

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (mode !== "edit") return
      const items = Array.from(e.clipboardData.items)
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile()
          if (file) {
            handleScreenshotFile(file)
          }
          break
        }
      }
    },
    [mode, handleScreenshotFile]
  )

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
        className
      )}
      onPaste={handlePaste}
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
            {isAborted
              ? "BUG 反馈已中止"
              : isConfirmed
                ? "已提交反馈"
                : isGenerating
                  ? "反馈表单生成中…"
                  : "BUG 反馈待确认"}
          </p>
          {mode === "view" && data.title && (
            <p className="mt-0.5 text-sm leading-snug font-medium">
              {data.title}
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
            已中止
          </span>
        )}
        {isConfirmed && !isAborted && (
          <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
            已提交
          </span>
        )}
      </div>

      {mode === "edit" ? (
        <div className="space-y-2">
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              标题
            </p>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="BUG 标题"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              问题描述
            </p>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="详细描述问题"
              rows={3}
              className="text-xs"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              复现步骤
            </p>
            <Textarea
              value={editReproSteps}
              onChange={(e) => setEditReproSteps(e.target.value)}
              placeholder="1. 打开...\n2. 点击...\n3. 看到..."
              rows={3}
              className="text-xs"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              预期行为
            </p>
            <Textarea
              value={editExpected}
              onChange={(e) => setEditExpected(e.target.value)}
              placeholder="期望看到什么"
              rows={2}
              className="text-xs"
            />
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              实际行为
            </p>
            <Textarea
              value={editActual}
              onChange={(e) => setEditActual(e.target.value)}
              placeholder="实际看到了什么"
              rows={2}
              className="text-xs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="include-logs-switch"
              size="sm"
              checked={editIncludeLogs}
              onCheckedChange={setEditIncludeLogs}
            />
            <Label htmlFor="include-logs-switch" className="text-[10px]">
              附带日志
            </Label>
          </div>
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              截图（可粘贴或上传，&lt;2MB）
            </p>
            {editScreenshot ? (
              <div className="flex items-start gap-2">
                <img
                  src={editScreenshot}
                  alt="screenshot preview"
                  className="max-h-32 max-w-full rounded border object-contain"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setEditScreenshot(null)}
                >
                  移除
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                选择截图
              </Button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleScreenshotFile(file)
                // reset so same file can be re-selected
                e.target.value = ""
              }}
            />
          </div>
        </div>
      ) : mode === "reject" ? (
        <Textarea
          value={rejectMessage}
          onChange={(e) => setRejectMessage(e.target.value)}
          placeholder="说明退回原因，例如：描述不够清晰、需要补充复现步骤"
          rows={4}
          className="text-xs"
        />
      ) : (
        <div className="space-y-1.5">
          {data.description && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                问题描述
              </p>
              <p className="text-[11px] text-muted-foreground">
                {data.description}
              </p>
            </div>
          )}
          {data.repro_steps && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                复现步骤
              </p>
              <pre className="whitespace-pre-wrap text-[11px] text-muted-foreground">
                {data.repro_steps}
              </pre>
            </div>
          )}
          {data.expected && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                预期行为
              </p>
              <p className="text-[11px] text-muted-foreground">
                {data.expected}
              </p>
            </div>
          )}
          {data.actual && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                实际行为
              </p>
              <p className="text-[11px] text-muted-foreground">{data.actual}</p>
            </div>
          )}
          {data.include_logs && (
            <p className="text-[10px] text-muted-foreground">附带日志：是</p>
          )}
          {data.screenshot && (
            <div>
              <p className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                截图
              </p>
              <img
                src={data.screenshot}
                alt="bug screenshot"
                className="max-h-32 max-w-full rounded border object-contain"
              />
            </div>
          )}
        </div>
      )}

      {isPending && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {mode === "view" && (
            <>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={submitting}
                onClick={handleApprove}
              >
                {submitting ? "提交中..." : "确认提交"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={submitting}
                onClick={enterEditMode}
              >
                修改
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                disabled={submitting}
                onClick={() => setMode("reject")}
              >
                退回
              </Button>
            </>
          )}
          {mode === "edit" && (
            <>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={submitting}
                onClick={handleEditSubmit}
              >
                {submitting ? "提交中..." : "确认修改"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setMode("view")}
              >
                取消
              </Button>
            </>
          )}
          {mode === "reject" && (
            <>
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                disabled={submitting}
                onClick={handleReject}
              >
                {submitting ? "提交中..." : "提交退回"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setMode("view")}
              >
                取消
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export const BugReportCard = memo(BugReportCardInner)

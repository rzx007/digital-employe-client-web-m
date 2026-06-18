"use client"

import * as React from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Textarea } from "@workspace/ui/components/textarea"
import { reworkOrchestrationTask } from "@/api/orchestration"

/**
 * 子任务返修按钮（#3 改改 / #7 重试）：点开写一句返修意见，
 * 走 rework 端点在原员工会话续聊重做。mode 仅影响文案/默认说明。
 */
export function TaskReworkButton({
  taskId,
  mode,
}: {
  taskId: number
  mode: "revise" | "retry"
}) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)

  const label = mode === "revise" ? "改改" : "重试"
  const title = mode === "revise" ? "让 TA 改改" : "重试该任务"
  const placeholder =
    mode === "revise"
      ? "想怎么改？（如：结论再具体些、补一张对比表）"
      : "可补充：上次为何失败、这次注意什么（留空则直接重试）"

  const handleSubmit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      const res = await reworkOrchestrationTask(taskId, note.trim())
      if (res.ok) {
        toast.success(res.message || "已发起返修")
        setOpen(false)
        setNote("")
      } else {
        // 达上限 / 前置未通过等 → 非 ok，原文展示让用户知情
        toast.warning(res.message || "无法返修")
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "返修请求失败")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="shrink-0 text-[10px] text-amber-600 hover:underline dark:text-amber-400"
        onClick={(e) => {
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              将在该员工原会话里带上一稿续聊重做（每任务最多自动返工 2 次）。
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            rows={3}
            className="text-xs"
            placeholder={placeholder}
            disabled={submitting}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              disabled={submitting}
              onClick={() => void handleSubmit()}
            >
              {submitting ? "提交中…" : "发起返修"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

"use client"

import * as React from "react"
import { memo, useState } from "react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { Input } from "@workspace/ui/components/input"
import { toast } from "sonner"
import { approveHitl } from "@/api/conversation"
import {
  isHitlAbortedOutput,
  type HitlPatchOptions,
} from "@/lib/chat/hitl-abort-message-utils"

interface DocumentPlanInput {
  title?: string
  outline?: string
  open_questions?: string
  planned_artifacts?: string
}

function parseOpenQuestions(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : []
  } catch {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
  }
}

function parsePlannedArtifacts(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : []
  } catch {
    return [raw]
  }
}

function buildEditDraftFromData(data: DocumentPlanInput) {
  return {
    title: data.title ?? "",
    outline: data.outline ?? "",
    questions: parseOpenQuestions(data.open_questions),
    artifacts: parsePlannedArtifacts(data.planned_artifacts),
  }
}

function DocumentPlanCardInner({
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

  const data = React.useMemo((): DocumentPlanInput | null => {
    if (!input || typeof input !== "object") return null
    return input as DocumentPlanInput
  }, [input])

  const [editTitle, setEditTitle] = useState("")
  const [editOutline, setEditOutline] = useState("")
  const [editQuestions, setEditQuestions] = useState<string[]>([])
  const [editArtifacts, setEditArtifacts] = useState<string[]>([])

  if (!data) return null

  const openQuestions = parseOpenQuestions(data.open_questions)
  const plannedArtifacts = parsePlannedArtifacts(data.planned_artifacts)
  const isAborted = isHitlAbortedOutput(resultText ?? undefined)
  const isPending =
    !resolved &&
    !isAborted &&
    (state === "input-available" ||
      state === "input-streaming" ||
      state === "call")
  const isConfirmed = !isAborted && state === "output-available"

  const submitDecisions = async (
    decisions: Array<{
      type: string
      message?: string
      edited_action?: unknown
    }>
  ) => {
    if (messageId == null || messageId === "") {
      toast.error("无法确认：缺少 messageId")
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
    if (submitting || resolved) return
    setSubmitting(true)
    try {
      const res = await approveHitl(conversationId, messageId, decisions)
      if (res?.code && res.code !== 200) {
        toast.error(res.msg || "确认失败")
        return
      }
      onHitlApproved?.({
        kind: "document-plan",
        toolCallId,
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

  const handleApprove = () => {
    void submitDecisions([{ type: "approve" }])
  }

  const enterEditMode = () => {
    const draft = buildEditDraftFromData(data)
    setEditTitle(draft.title)
    setEditOutline(draft.outline)
    setEditQuestions(draft.questions)
    setEditArtifacts(draft.artifacts)
    setMode("edit")
  }

  const handleReject = () => {
    const msg = rejectMessage.trim()
    if (!msg) {
      toast.error("请填写修订意见")
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
          name: "submit_document_plan",
          args: {
            title: editTitle.trim() || data.title || "文档方案",
            outline: editOutline.trim() || data.outline || "",
            open_questions: JSON.stringify(
              editQuestions.map((q) => q.trim()).filter(Boolean)
            ),
            planned_artifacts: JSON.stringify(
              editArtifacts.map((p) => p.trim()).filter(Boolean)
            ),
          },
        },
      },
    ])
    setMode("view")
  }

  const updateListItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    index: number,
    value: string
  ) => {
    const next = [...list]
    next[index] = value
    setList(next)
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card p-3 text-sm",
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
            {isAborted
              ? "文档方案已中止"
              : isConfirmed
                ? "文档方案已确认"
                : "长文档方案待确认"}
          </p>
          {mode === "view" && data.title && (
            <p className="mt-0.5 text-sm leading-snug font-medium">
              {data.title}
            </p>
          )}
        </div>
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
      </div>

      {mode === "edit" ? (
        <div className="space-y-2">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="方案标题"
            className="h-8 text-xs"
          />
          <Textarea
            value={editOutline}
            onChange={(e) => setEditOutline(e.target.value)}
            placeholder="大纲（Markdown，章节用 ## 标题）"
            rows={8}
            className="font-mono text-xs"
          />
          <div>
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">
              计划产物路径
            </p>
            <div className="space-y-1">
              {editArtifacts.map((p, i) => (
                <div key={i} className="flex gap-1">
                  <Input
                    value={p}
                    onChange={(e) =>
                      updateListItem(
                        editArtifacts,
                        setEditArtifacts,
                        i,
                        e.target.value
                      )
                    }
                    placeholder="/artifacts/chapter-1.md"
                    className="h-7 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() =>
                      setEditArtifacts(editArtifacts.filter((_, j) => j !== i))
                    }
                  >
                    移除
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => setEditArtifacts([...editArtifacts, ""])}
              >
                添加路径
              </Button>
            </div>
          </div>
        </div>
      ) : mode === "reject" ? (
        <Textarea
          value={rejectMessage}
          onChange={(e) => setRejectMessage(e.target.value)}
          placeholder="说明需要如何修订方案，例如：增加风险章节、调整第三章标题"
          rows={4}
          className="text-xs"
        />
      ) : (
        <>
          {data.outline && (
            <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap">
              {data.outline}
            </pre>
          )}
          {openQuestions.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                待确认问题
              </p>
              <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                {openQuestions.map((q, i) => (
                  <li key={i}>· {q}</li>
                ))}
              </ul>
            </div>
          )}
          {plannedArtifacts.length > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                计划产出文件
              </p>
              <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                {plannedArtifacts.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </>
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
                {submitting ? "提交中..." : "开始写作"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={submitting}
                onClick={enterEditMode}
              >
                修改大纲
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                disabled={submitting}
                onClick={() => setMode("reject")}
              >
                退回修改
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

export const DocumentPlanCard = memo(DocumentPlanCardInner)

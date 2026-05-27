"use client"

import * as React from "react"
import { memo, useCallback, useRef, useState } from "react"
import { useEventListener } from "@reactuses/core"
import {
  IconChevronDown,
  IconChevronUp,
  IconMessageCircle,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "sonner"
import { approveHitl, type HitlDecision } from "@/api/chat"
import {
  buildClarifyRespondMessage,
  CLARIFY_SKIP_REJECT_MESSAGE,
  isValidApproveMessageId,
  optionLabel,
  type ActiveHitl,
  type ClarifyingQuestion,
  type PendingHitl,
} from "@/lib/chat/hitl"

function isComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest("[data-chat-composer]"))
}

function ClarifyingQuestionsDockInner({
  activeHitl,
  pending,
  conversationId,
  optionalDetails,
  onSubmitted,
  className,
}: {
  activeHitl: ActiveHitl
  pending: PendingHitl & { input: Record<string, unknown> }
  conversationId: string | number
  optionalDetails?: string
  onSubmitted?: (opts?: {
    resumed?: boolean
    assistantMessageId?: string | number
  }) => void | Promise<void>
  className?: string
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  const continueButtonRef = useRef<HTMLButtonElement>(null)
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)

  const questionsInput = pending.input?.questions
  const context =
    typeof pending.input?.context === "string"
      ? pending.input.context
      : undefined
  const questions = React.useMemo(() => {
    if (!questionsInput) return []
    if (typeof questionsInput === "string") {
      try {
        const parsed = JSON.parse(questionsInput)
        return Array.isArray(parsed) ? (parsed as ClarifyingQuestion[]) : []
      } catch {
        return []
      }
    }
    return Array.isArray(questionsInput)
      ? (questionsInput as ClarifyingQuestion[])
      : []
  }, [questionsInput])

  const total = questions.length
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const current = questions[index]
  const currentAnswer = current ? (answers[current.id] ?? "") : ""

  const setCurrentAnswer = useCallback(
    (value: string) => {
      if (!current) return
      setAnswers((prev) => ({ ...prev, [current.id]: value }))
    },
    [current]
  )

  const focusContinueButton = useCallback(() => {
    requestAnimationFrame(() => continueButtonRef.current?.focus())
  }, [])

  const validateCurrent = useCallback((): boolean => {
    if (!current?.required) return true
    if (currentAnswer.trim()) return true
    toast.error("请先回答当前问题")
    return false
  }, [current, currentAnswer])

  const submitDecisions = useCallback(
    async (decisions: HitlDecision[], errorFallback: string) => {
      if (submitting) return
      if (!isValidApproveMessageId(activeHitl.dbMessageId)) {
        toast.error("无法提交：缺少有效的消息 ID，请刷新后重试")
        return
      }
      setSubmitting(true)
      try {
        const res = await approveHitl(
          conversationId,
          activeHitl.dbMessageId,
          decisions
        )
        if (res?.code && res.code !== 200) {
          toast.error(res.msg || errorFallback)
          return
        }
        await onSubmitted?.({
          resumed: true,
          assistantMessageId: res?.data?.assistant_message_id,
        })
      } catch {
        toast.error("请求失败")
      } finally {
        setSubmitting(false)
      }
    },
    [activeHitl.dbMessageId, conversationId, onSubmitted, submitting]
  )

  const submitAll = useCallback(async () => {
    const missing = questions.filter(
      (q) => q.required && !answers[q.id]?.trim()
    )
    if (missing.length > 0) {
      toast.error(`请完成必填项：${missing.map((q) => q.prompt).join("、")}`)
      return
    }

    const message = buildClarifyRespondMessage(
      questions,
      answers,
      context,
      optionalDetails
    )
    await submitDecisions([{ type: "respond", message }], "提交失败")
  }, [answers, context, optionalDetails, questions, submitDecisions])

  const handleContinue = useCallback(() => {
    if (!validateCurrent()) return
    if (index < total - 1) {
      setIndex((i) => i + 1)
      return
    }
    void submitAll()
  }, [index, submitAll, total, validateCurrent])

  const handlePrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  const handleNext = useCallback(() => {
    if (!validateCurrent()) return
    setIndex((i) => Math.min(total - 1, i + 1))
  }, [total, validateCurrent])

  const handleSkip = useCallback(() => {
    void submitDecisions(
      [{ type: "reject", message: CLARIFY_SKIP_REJECT_MESSAGE }],
      "跳过失败"
    )
  }, [submitDecisions])

  const handleDockKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (isComposerTarget(event.target)) return

      if (event.key === "Escape") {
        event.preventDefault()
        handleSkip()
        return
      }

      if (event.key !== "Enter" || event.shiftKey) return

      const target = event.target
      if (target instanceof HTMLTextAreaElement) return
      if (target instanceof HTMLElement && target.closest("button")) return

      event.preventDefault()
      handleContinue()
    },
    [handleContinue, handleSkip]
  )

  useEventListener("keydown", handleDockKeyDown, dockRef)

  React.useEffect(() => {
    if (!current) return
    requestAnimationFrame(() => {
      if (current.type === "choice" && current.options?.length) {
        continueButtonRef.current?.focus()
      } else {
        answerTextareaRef.current?.focus()
      }
    })
  }, [current, index])

  const handleTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      handleContinue()
    }
  }

  const handleChoiceSelect = (opt: string) => {
    setCurrentAnswer(opt)
    focusContinueButton()
  }

  if (!current) return null

  return (
    <div
      ref={dockRef}
      tabIndex={-1}
      className={cn(
        "mb-2 overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm outline-none",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <IconMessageCircle className="size-3.5 shrink-0" />
          <span>Questions</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
          <span className="tabular-nums">
            {index + 1} of {total}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={index === 0}
            onClick={handlePrev}
            aria-label="上一题"
          >
            <IconChevronUp className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6"
            disabled={index >= total - 1}
            onClick={handleNext}
            aria-label="下一题"
          >
            <IconChevronDown className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="px-3 py-3">
        <p className="text-sm leading-snug font-semibold text-foreground">
          {index + 1}. {current.prompt}
          {current.required && (
            <span className="ml-0.5 text-destructive">*</span>
          )}
        </p>

        {current.type === "choice" && current.options?.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {current.options.map((opt, i) => (
              <Button
                key={optionLabel(i)}
                type="button"
                variant={currentAnswer === opt ? "default" : "outline"}
                size="sm"
                className="h-auto min-w-20 px-3 py-1.5 text-xs"
                onClick={() => handleChoiceSelect(opt)}
              >
                <span className="mr-1 font-medium">{optionLabel(i)}.</span>
                {opt}
              </Button>
            ))}
          </div>
        ) : (
          <Textarea
            ref={answerTextareaRef}
            value={currentAnswer}
            onChange={(e) => setCurrentAnswer(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="请输入你的回答...（Enter 继续，Shift+Enter 换行）"
            rows={3}
            className="mt-2.5 text-sm"
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          disabled={submitting}
          onClick={handleSkip}
        >
          Skip
        </Button>
        <Button
          ref={continueButtonRef}
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={submitting}
          onClick={handleContinue}
        >
          {submitting ? "提交中..." : index < total - 1 ? "继续" : "提交"}
        </Button>
      </div>
    </div>
  )
}

export const ClarifyingQuestionsDock = memo(ClarifyingQuestionsDockInner)

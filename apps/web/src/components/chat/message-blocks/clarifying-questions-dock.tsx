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
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { toast } from "sonner"
import { approveHitl, type HitlDecision } from "@/api/chat"
import {
  buildClarifyRespondMessage,
  CLARIFY_DEFAULT_ASSUMPTIONS_MESSAGE,
  isValidApproveMessageId,
  isHitlAlreadyApprovedError,
  optionLabel,
  parseClarifyingQuestions,
  type ActiveHitl,
  type ClarifyingQuestion,
  type PendingHitl,
} from "@/lib/chat/hitl"

/** 澄清题目解析失败时：单题开放式作答，避免误用无关 demo 选项 */
const FALLBACK_MANUAL_CLARIFY_QUESTIONS: ClarifyingQuestion[] = [
  {
    id: "manual",
    prompt: "组长题目未能加载，请根据上方组长说明，完整填写你的澄清回答：",
    type: "text",
    required: true,
  },
]

function isComposerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest("[data-chat-composer]"))
}

function ClarifyingQuestionsDockInner({
  activeHitl,
  pending,
  conversationId,
  optionalDetails,
  clarifyInputOverride,
  onSubmitted,
  className,
}: {
  activeHitl: ActiveHitl
  pending: PendingHitl & { input: Record<string, unknown> }
  conversationId: string | number
  optionalDetails?: string
  /** 群时间线投影：从 message_parts 补全 tool input（composer 里没有） */
  clarifyInputOverride?: Record<string, unknown>
  onSubmitted?: (opts?: {
    resumed?: boolean
    assistantMessageId?: string | number
  }) => void | Promise<void>
  className?: string
}) {
  const dockRef = useRef<HTMLDivElement>(null)
  const continueButtonRef = useRef<HTMLButtonElement>(null)
  const answerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const choiceCustomInputRef = useRef<HTMLInputElement>(null)

  const mergedInput = React.useMemo(
    () =>
      ({
        ...(clarifyInputOverride ?? {}),
        ...pending.input,
      }) as Record<string, unknown>,
    [clarifyInputOverride, pending.input]
  )

  const questionsInput = mergedInput.questions
  const context =
    typeof mergedInput.context === "string" ? mergedInput.context : undefined
  const questions = React.useMemo(() => {
    const parsed = parseClarifyingQuestions(questionsInput)
    if (parsed.length > 0) return parsed
    return FALLBACK_MANUAL_CLARIFY_QUESTIONS
  }, [questionsInput])

  const parsedFromLeader = React.useMemo(
    () => parseClarifyingQuestions(questionsInput),
    [questionsInput]
  )

  const total = questions.length
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const current = questions[index]
  const currentAnswer = current ? (answers[current.id] ?? "") : ""
  const isChoiceQuestion = Boolean(
    current?.type === "choice" && current.options && current.options.length > 0
  )
  const choiceSelectedOption =
    isChoiceQuestion && current?.options?.includes(currentAnswer)
      ? currentAnswer
      : ""
  const choiceCustomText =
    isChoiceQuestion && !choiceSelectedOption ? currentAnswer : ""

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
          if (isHitlAlreadyApprovedError(res.msg)) {
            await onSubmitted?.({ resumed: false })
            return
          }
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
      [{ type: "respond", message: CLARIFY_DEFAULT_ASSUMPTIONS_MESSAGE }],
      "提交失败"
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
      if (isChoiceQuestion) {
        choiceCustomInputRef.current?.focus()
      } else {
        answerTextareaRef.current?.focus()
      }
    })
  }, [current, index, isChoiceQuestion])

  const handleTextareaKeyDown = (
    event: React.KeyboardEvent<HTMLTextAreaElement>
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      handleContinue()
    }
  }

  const handleChoiceCustomKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
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

  const handleChoiceCustomChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setCurrentAnswer(event.target.value)
  }

  if (!current) {
    return null
  }

  const usingFallbackQuestions = parsedFromLeader.length === 0

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
          <span>{usingFallbackQuestions ? "手动作答（组长题目加载失败）" : "Questions"}</span>
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

        {isChoiceQuestion && current.options ? (
          <>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {current.options.map((opt, i) => (
                <Button
                  key={optionLabel(i)}
                  type="button"
                  variant={choiceSelectedOption === opt ? "default" : "outline"}
                  size="sm"
                  className="h-auto min-w-20 px-3 py-1.5 text-xs"
                  onClick={() => handleChoiceSelect(opt)}
                >
                  <span className="mr-1 font-medium">{optionLabel(i)}.</span>
                  {opt}
                </Button>
              ))}
            </div>
            <Input
              ref={choiceCustomInputRef}
              value={choiceCustomText}
              onChange={handleChoiceCustomChange}
              onKeyDown={handleChoiceCustomKeyDown}
              placeholder="以上都不符合？请手动填写（Enter 继续）"
              className="mt-2.5 h-9 text-sm"
            />
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              每题可在上方选择或填写；底部输入框仅用于整份澄清的额外补充说明。
            </p>
          </>
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
          用默认继续
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

"use client"

import * as React from "react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { ChatPromptInput } from "@/components/chat-prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "@/components/lexical-editor/mention-plugin"
import type { ChatPromptMessageStatus } from "@/components/chat-prompt-input/types"
import { ClarifyingQuestionsDock } from "@/components/chat/message-blocks/clarifying-questions-dock"
import { PendingMessageQueue } from "@/components/chat/panel/pending-message-queue"
import type { PendingMessage } from "@/hooks/use-pending-messages"
import {
  findPendingHitl,
  type HitlPatchOptions,
  type PendingHitl,
} from "@/lib/chat/hitl-abort-message-utils"

const CLARIFY_OPTIONAL_PLACEHOLDER = "补充更多可选细节（可选）"
const HITL_PENDING_PLACEHOLDER = "请先确认或中止当前待办"

export function ChatComposerArea({
  messages,
  conversationId,
  hitlMessageId,
  hitlPayload,
  inputValue,
  onInputChange,
  onSend,
  onStop,
  onHitlApproved,
  hitlInterrupted,
  status,
  submitDisabled,
  placeholder,
  size = "compact",
  className,
  slashCommands,
  mentionCandidates,
  onAttachmentsChange,
  pendingMessages,
  onPendingRemove,
  onPendingSendNow,
  onPendingMoveUp,
  onPendingMoveDown,
  error,
  pendingQueueClassName,
}: {
  messages: UIMessage[]
  conversationId: string | number
  hitlMessageId: string | null
  inputValue: string
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage | string) => void
  onStop: () => void
  onHitlApproved?: (options?: HitlPatchOptions) => void
  hitlInterrupted: boolean
  hitlPayload?: {
    action_requests: Array<{ name: string; args: Record<string, unknown> }>
    review_configs: unknown[]
  } | null
  status: ChatPromptMessageStatus
  submitDisabled?: boolean
  placeholder?: string
  size?: "compact" | "full"
  className?: string
  slashCommands?: SlashCommandItem[]
  mentionCandidates?: MentionCandidate[]
  onAttachmentsChange?: (paths: string[]) => void
  pendingMessages?: PendingMessage[]
  onPendingRemove?: (id: string) => void
  onPendingSendNow?: (id: string) => void
  onPendingMoveUp?: (id: string) => void
  onPendingMoveDown?: (id: string) => void
  error?: Error | null
  pendingQueueClassName?: string
}) {
  const pendingHitl: (PendingHitl & { input: Record<string, unknown> }) | null =
    React.useMemo(() => {
      if (!hitlPayload) return null
      const action = hitlPayload.action_requests[0]
      if (!action) return null
      const kind =
        action.name === "submit_clarifying_questions"
          ? ("clarify" as const)
          : ("document-plan" as const)
      const fromMessages = findPendingHitl(messages)
      return {
        kind,
        messageId: fromMessages?.messageId ?? "",
        toolCallId: fromMessages?.toolCallId ?? "",
        input: (fromMessages?.input ?? action.args ?? {}) as Record<
          string,
          unknown
        >,
      }
    }, [hitlPayload, messages])

  const clarifyActive = hitlInterrupted && pendingHitl?.kind === "clarify"

  const planActive = hitlInterrupted && pendingHitl?.kind === "document-plan"

  const blocksComposer = clarifyActive || planActive

  const handleClarifySubmitted = React.useCallback(
    (opts?: { resumed?: boolean; assistantMessageId?: string | number }) => {
      onHitlApproved?.({
        kind: "clarify",
        toolCallId: pendingHitl?.toolCallId,
        resumed: opts?.resumed,
        assistantMessageId: opts?.assistantMessageId,
      })
    },
    [onHitlApproved, pendingHitl]
  )

  const handleSkip = React.useCallback(() => {
    onStop()
  }, [onStop])

  return (
    <div className={className}>
      {pendingMessages &&
        pendingMessages.length > 0 &&
        onPendingRemove &&
        onPendingSendNow &&
        onPendingMoveUp &&
        onPendingMoveDown && (
          <div className={pendingQueueClassName}>
            <PendingMessageQueue
              queue={pendingMessages}
              onRemove={onPendingRemove}
              onSendNow={onPendingSendNow}
              onMoveUp={onPendingMoveUp}
              onMoveDown={onPendingMoveDown}
            />
          </div>
        )}

      {clarifyActive && pendingHitl && hitlMessageId && (
        <ClarifyingQuestionsDock
          pending={pendingHitl}
          conversationId={conversationId}
          messageId={hitlMessageId}
          optionalDetails={inputValue}
          onSubmitted={handleClarifySubmitted}
          onSkip={handleSkip}
          className="mx-auto w-full max-w-4xl"
        />
      )}

      <ChatPromptInput
        value={inputValue}
        onChange={onInputChange}
        onSubmit={onSend}
        onStop={onStop}
        status={status}
        disabled={submitDisabled || blocksComposer}
        placeholder={
          clarifyActive
            ? CLARIFY_OPTIONAL_PLACEHOLDER
            : blocksComposer
              ? HITL_PENDING_PLACEHOLDER
              : placeholder
        }
        size={size}
        className="w-full"
        slashCommands={slashCommands}
        mentionCandidates={mentionCandidates}
        conversationId={String(conversationId)}
        onAttachmentsChange={onAttachmentsChange}
      />

      {error && (
        <p className="mt-2 text-xs text-destructive">{error.message}</p>
      )}
    </div>
  )
}

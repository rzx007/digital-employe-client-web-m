"use client"

import * as React from "react"
import type { UIMessage } from "ai"
import type { PromptInputMessage } from "@workspace/ui/components/ai-elements/prompt-input"
import { ChatPromptInput } from "@/components/chat-prompt-input"
import type { PromptChangeEvent } from "@/components/lexical-editor/prompt-input-textarea"
import type { SlashCommandItem } from "@/components/lexical-editor/slash-command-plugin"
import type { MentionCandidate } from "@/components/lexical-editor/mention-plugin"
import type {
  ChatPromptInputProps,
  ChatPromptMessageStatus,
} from "@/components/chat-prompt-input/types"
import { ClarifyingQuestionsDock } from "@/components/chat/message-blocks/clarifying-questions-dock"
import { PendingMessageQueue } from "@/components/chat/panel/pending-message-queue"
import type { PendingMessage } from "@/hooks/use-pending-messages"
import {
  activeHitlMatchesPending,
  findPendingHitl,
  type ActiveHitl,
  type HitlPatchOptions,
  type PendingHitl,
} from "@/lib/chat/hitl"

const CLARIFY_OPTIONAL_PLACEHOLDER =
  "整份澄清的额外补充说明（可选，非单题答案）"
const HITL_PENDING_PLACEHOLDER = "请先确认或中止当前待办"

export function ChatComposerArea({
  messages,
  conversationId,
  inputValue,
  onInputChange,
  onSend,
  onStop,
  onHitlApproved,
  activeHitl = null,
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
  showContextBudget = true,
}: {
  messages: UIMessage[]
  conversationId: string | number | null
  inputValue: string
  onInputChange: (event: PromptChangeEvent) => void
  onSend: (message: PromptInputMessage | string) => void
  onStop: () => void
  onHitlApproved?: (options?: HitlPatchOptions) => void
  activeHitl?: ActiveHitl | null
  status: ChatPromptMessageStatus
  submitDisabled?: boolean
  placeholder?: React.ReactNode
  size?: ChatPromptInputProps["size"]
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
  showContextBudget?: boolean
}) {
  const pendingHitl: (PendingHitl & { input: Record<string, unknown> }) | null =
    React.useMemo(() => {
      const hitl = findPendingHitl(messages)
      if (!hitl) return null
      return {
        ...hitl,
        input: (hitl.input ?? {}) as Record<string, unknown>,
      }
    }, [messages])

  const clarifyActive =
    activeHitl?.kind === "clarify" &&
    (!pendingHitl ||
      activeHitlMatchesPending(activeHitl, pendingHitl.toolCallId))

  const planActive = pendingHitl?.kind === "document-plan"
  const destructiveDeleteActive = pendingHitl?.kind === "destructive-delete"
  const blocksComposer = clarifyActive || planActive || destructiveDeleteActive

  const dockPending = React.useMemo(():
    | (PendingHitl & {
        input: Record<string, unknown>
      })
    | null => {
    if (!activeHitl || activeHitl.kind !== "clarify") return null
    const input = (pendingHitl?.input ?? activeHitl.input ?? {}) as Record<
      string,
      unknown
    >
    return {
      kind: "clarify",
      messageId: pendingHitl?.messageId ?? "",
      toolCallId: activeHitl.toolCallId,
      input,
    }
  }, [activeHitl, pendingHitl])

  const handleClarifySubmitted = React.useCallback(
    (opts?: { resumed?: boolean; assistantMessageId?: string | number }) => {
      if (!activeHitl) return
      onHitlApproved?.({
        kind: "clarify",
        toolCallId: activeHitl.toolCallId,
        approvedMessageId: activeHitl.dbMessageId,
        resumed: opts?.resumed,
        assistantMessageId: opts?.assistantMessageId,
      })
    },
    [activeHitl, onHitlApproved]
  )

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

      {clarifyActive && activeHitl && dockPending && (
        <ClarifyingQuestionsDock
          activeHitl={activeHitl}
          pending={dockPending}
          conversationId={activeHitl.conversationIdOverride ?? conversationId}
          optionalDetails={inputValue}
          onSubmitted={handleClarifySubmitted}
          className="mx-auto w-full max-w-4xl"
        />
      )}

      <div data-chat-composer className="w-full">
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
          conversationId={
            conversationId != null ? String(conversationId) : null
          }
          onAttachmentsChange={onAttachmentsChange}
          messages={messages}
          showContextBudget={showContextBudget}
        />
      </div>

      {error && (
        <p className="mt-2 text-xs text-destructive">{error.message}</p>
      )}
    </div>
  )
}

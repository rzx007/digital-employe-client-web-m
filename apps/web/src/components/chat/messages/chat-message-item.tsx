import * as React from "react"
import type { UIMessage } from "ai"
import { IconClipboardList } from "@tabler/icons-react"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { getCopyableMessageText } from "@/lib/chat/message-utils"
import { getDispatchBadge } from "@/lib/chat/assistant-stream-state"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { useAuthStore } from "@/stores/auth-store"
import { cn } from "@workspace/ui/lib/utils"
import {
  resolveHitlApproveMessageId,
  parseDbMessageId,
  getDbMessageIdFromAssistantMessage,
  CLARIFY_TOOL_NAME,
  type ActiveHitl,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"
import { resolveGroupClarifyTarget } from "@/lib/chat/hitl/group-clarify-target"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "../contacts/contact-avatars"
import {
  getContactDisplayName,
  getElapsedMsFromMeta,
  type ChatViewContact,
} from "../shared/chat-view-shared"
import { MessageAssistantActions } from "./message-assistant-actions"
import { MessageCopyAction } from "./message-copy-action"
import { useClassifiedMessageBlocks } from "@/hooks/use-classified-message-blocks"
import { BlockRenderer } from "../message-blocks/block-render-map"
import { ClarifyingQuestionsDock } from "../message-blocks/clarifying-questions-dock"

export interface ChatMessageItemProps {
  message: UIMessage
  contact: ChatViewContact
  includeFileChanges: boolean
  /** 是否为列表中最后一条 assistant（当前流式轮） */
  isLastAssistantMessage?: boolean
  /** 本轮是否已结束（status ready/error），末项工具据此延迟收起 */
  isTurnEnded?: boolean
  conversationId?: string | number | null
  activeHitl?: ActiveHitl | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
}

function ChatMessageItemInner({
  message,
  contact,
  includeFileChanges,
  isLastAssistantMessage = false,
  isTurnEnded = true,
  conversationId,
  activeHitl,
  onHitlApproved,
}: ChatMessageItemProps) {
  const contactDisplayName = getContactDisplayName(contact)
  const userName = useAuthStore((s) => s.user?.name) || "我"
  const deferredMessage = React.useDeferredValue(message)
  const {
    blocks: classifiedBlocks,
    toolAutoCollapseMap,
    commandMeta,
    mentionMeta,
    filesMeta,
  } = useClassifiedMessageBlocks(message, {
    includeFileChanges,
    isLastAssistantMessage,
    isTurnEnded,
  })

  const elapsedMs = getElapsedMsFromMeta(deferredMessage)
  const copyText = React.useMemo(
    () => getCopyableMessageText(deferredMessage, { includeFileChanges }),
    [deferredMessage, includeFileChanges]
  )
  const hitlApproveMessageId = React.useMemo(
    () => resolveHitlApproveMessageId(message, activeHitl),
    [message, activeHitl]
  )

  // 自动派单的首条 user 消息：后端 extra_meta 标记，邮戳与真人消息区分。
  const dispatchBadge = React.useMemo(() => {
    if (message.role !== "user") return null
    return getDispatchBadge(
      (message as { metadata?: Record<string, unknown> }).metadata
    )
  }, [message])

  // 群澄清卡片：检测群消息 extra_meta 含组长会话 id + 中断消息 id，
  // 从 parts 解析 pending 澄清 input，渲染内嵌卡片提交到组长会话。
  const groupClarifyDock = React.useMemo(() => {
    if (message.role !== "assistant") return null
    const meta = (message as { metadata?: Record<string, unknown> }).metadata
    const target = resolveGroupClarifyTarget(meta ?? null)
    if (!target) return null

    // 从 parts 找 submit_clarifying_questions 的 input-available part
    const clarifyToolType = `tool-${CLARIFY_TOOL_NAME}`
    const pendingPart = message.parts.find(
      (p) =>
        p.type === clarifyToolType &&
        (p as { state?: string }).state === "input-available"
    ) as
      | { type: string; toolCallId?: string; state?: string; input?: unknown }
      | undefined
    if (!pendingPart) return null

    const toolCallId =
      typeof pendingPart.toolCallId === "string" ? pendingPart.toolCallId : ""
    const input = (pendingPart.input ?? {}) as Record<string, unknown>

    // 群消息自身的 DB id，用于提交后乐观隐藏卡片（approved_at patch）
    const groupMsgDbId = getDbMessageIdFromAssistantMessage({
      id: message.id,
      metadata: meta,
    })

    // 组长会话中断消息 id（/approve 的 message_id）
    const leaderMsgDbId = parseDbMessageId(target.messageId)
    if (!leaderMsgDbId) return null

    const fakeActiveHitl: ActiveHitl = {
      dbMessageId: leaderMsgDbId,
      toolCallId,
      kind: "clarify",
      input,
    }
    const fakePending = {
      kind: "clarify" as const,
      messageId: message.id,
      toolCallId,
      input,
    }

    return {
      activeHitl: fakeActiveHitl,
      pending: fakePending,
      targetConversationId: target.conversationId,
      groupMsgDbId,
    }
  }, [message])

  const handleGroupClarifySubmitted = React.useCallback(
    (opts?: { resumed?: boolean; assistantMessageId?: string | number }) => {
      if (!groupClarifyDock) return
      onHitlApproved?.({
        kind: "clarify",
        toolCallId: groupClarifyDock.activeHitl.toolCallId,
        approvedMessageId: groupClarifyDock.groupMsgDbId ?? undefined,
        // 群澄清提交后不 resume 群会话（组长会话自行 resume）
        resumed: false,
        assistantMessageId: opts?.assistantMessageId,
      })
    },
    [groupClarifyDock, onHitlApproved]
  )

  const messageBody = (
    <div className="space-y-1.5">
      {classifiedBlocks.length > 0 ? (
        classifiedBlocks.map((block) => (
          <BlockRenderer
            key={block.key}
            block={block}
            ctx={{
              messageId: hitlApproveMessageId,
              conversationId,
              toolAutoCollapseMap,
              isLastAssistantMessage,
              isTurnEnded,
              onHitlApproved,
              commandMeta: commandMeta ?? {},
              mentionMeta,
              filesMeta,
            }}
          />
        ))
      ) : (
        <MessageResponse />
      )}
      {groupClarifyDock && (
        <ClarifyingQuestionsDock
          activeHitl={groupClarifyDock.activeHitl}
          pending={groupClarifyDock.pending}
          conversationId={groupClarifyDock.targetConversationId}
          onSubmitted={handleGroupClarifySubmitted}
          className="w-full"
        />
      )}
    </div>
  )

  return (
    <Message from={message.role} className={cn("group mx-auto max-w-4xl")}>
      {message.role === "assistant" && (
        <div className="mb-2 flex items-center gap-2">
          {contact.type === "group" ? (
            (() => {
              // 群时间线：按消息发言人显示头像（组长/某成员），而非群拼图
              const meta = (
                message as { metadata?: Record<string, unknown> }
              ).metadata
              const senderName =
                typeof meta?.senderName === "string"
                  ? meta.senderName
                  : undefined
              const senderId =
                typeof meta?.senderId === "string" ? meta.senderId : undefined
              const member = contact.group?.participants.find(
                (p) => p.id === senderId || p.name === senderName
              )
              if (member) {
                return (
                  <EmployeeContactAvatar
                    name={member.name}
                    avatar={member.avatar}
                    avatarClassName="size-6"
                    fallbackClassName="text-[10px]"
                  />
                )
              }
              // 组长（无 sender_id）用总管头像；用户/无法识别则回退群拼图
              if (senderName === "组长") {
                return (
                  <EmployeeContactAvatar
                    name="组长"
                    avatar={CURATOR_AVATAR_URL}
                    avatarClassName="size-6"
                    fallbackClassName="text-[10px]"
                  />
                )
              }
              return (
                <GroupMembersAvatar
                  participants={contact.group?.participants}
                  className="size-6"
                  itemClassName="h-3 w-3"
                  fallbackClassName="text-[8px]"
                  placeholderClassName="h-3 w-3"
                />
              )
            })()
          ) : contact.type === "curator" ? (
            <EmployeeContactAvatar
              name={contact.curator?.name}
              avatar={contact.curator?.avatar}
              status={contact.curator?.status}
              avatarClassName="size-6"
              fallbackClassName="text-[10px]"
            />
          ) : (
            <EmployeeContactAvatar
              name={contact.employee?.name}
              avatar={contact.employee?.avatar}
              status={contact.employee?.status}
              avatarClassName="size-6"
              fallbackClassName="text-[10px]"
            />
          )}
          <span className="text-xs text-muted-foreground">
            {(() => {
              if (contact.type !== "group") return contactDisplayName
              const meta = (
                message as { metadata?: Record<string, unknown> }
              ).metadata
              const s =
                typeof meta?.senderName === "string"
                  ? meta.senderName
                  : undefined
              return s || contactDisplayName
            })()}
          </span>
        </div>
      )}
      {message.role === "user" && !dispatchBadge && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">{userName}</span>
          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary ring-1 ring-primary/15">
            {userName.trim().slice(0, 2)}
          </div>
        </div>
      )}
      {dispatchBadge ? (
        <div
          className="ml-auto flex w-fit items-center gap-1 text-[11px] font-medium text-amber-600/90 dark:text-amber-400/90"
          title={dispatchBadge.title}
        >
          <IconClipboardList className="size-3" />
          {dispatchBadge.label}
        </div>
      ) : null}
      <MessageContent className="w-auto">{messageBody}</MessageContent>
      {message.role === "assistant" ? (
        <MessageAssistantActions
          copyText={copyText}
          elapsedMs={elapsedMs}
          isLastAssistantMessage={isLastAssistantMessage}
          isTurnEnded={isTurnEnded}
        />
      ) : (
        <MessageCopyAction text={copyText} />
      )}
    </Message>
  )
}

export const ChatMessageItem = React.memo(ChatMessageItemInner)

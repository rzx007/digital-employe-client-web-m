import * as React from "react"
import type { UIMessage } from "ai"
import { IconClipboardList } from "@tabler/icons-react"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { getCopyableMessageText } from "@/lib/chat/message-utils"
import {
  getDispatchBadge,
  getChannelBadge,
} from "@/lib/chat/assistant-stream-state"
import { UserAvatar } from "@/components/user-avatar"
import { useAuthStore } from "@/stores/auth-store"
import { cn } from "@workspace/ui/lib/utils"
import {
  resolveHitlApproveMessageId,
  type ActiveHitl,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import {
  getContactDisplayName,
  getElapsedMsFromMeta,
  type ChatViewContact,
} from "../shared/chat-view-shared"
import { MessageAssistantActions } from "./message-assistant-actions"
import { MessageCopyAction } from "./message-copy-action"
import { VoiceMessageCapsule } from "./voice-message-capsule"
import { getVoiceMeta } from "@/lib/voice/voice-meta"
import { useClassifiedMessageBlocks } from "@/hooks/use-classified-message-blocks"
import { BlockRenderer } from "../message-blocks/block-render-map"

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
  const user = useAuthStore((s) => s.user)
  const userName = user?.name || "我"
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

  // channel 来源（飞书等）的 user 消息：显示渠道名+logo 头部（替代名字头像）。
  const channelBadge = React.useMemo(() => {
    if (message.role !== "user") return null
    return getChannelBadge(
      (message as { metadata?: Record<string, unknown> }).metadata
    )
  }, [message])

  // 用户语音消息：metadata.voice 合法时气泡换成微信式语音胶囊。
  const voiceMeta =
    message.role === "user"
      ? getVoiceMeta(
          (message as { metadata?: Record<string, unknown> }).metadata
        )
      : null

  // 群里组长的编排计划存在 leader 会话（非群会话）。把投影消息携带的
  // source_conversation_id 透给计划卡，让它查到计划真实状态（否则按钮永不消失）。
  const planConversationId = React.useMemo(() => {
    const meta = (message as { metadata?: Record<string, unknown> }).metadata
    const src = meta?.source_conversation_id ?? meta?.sourceConversationId
    if (typeof src === "number") return src
    if (typeof src === "string" && src.trim()) return src
    return null
  }, [message])

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
              planConversationId,
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
    </div>
  )

  return (
    <Message from={message.role} className={cn("group mx-auto max-w-4xl")}>
      {message.role === "assistant" && (
        <div className="mb-2 flex items-center gap-2">
          {contact.type === "curator" ? (
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
            {contactDisplayName}
          </span>
        </div>
      )}
      {message.role === "user" && !dispatchBadge && !channelBadge && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">{userName}</span>
          <div className="size-6 shrink-0 overflow-hidden rounded">
            <UserAvatar
              userId={user?.id}
              alt={userName}
              className="size-full object-cover"
            />
          </div>
        </div>
      )}
      {message.role === "user" && !dispatchBadge && channelBadge && (
        <div className="mb-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {channelBadge.name}
          </span>
          <div className="size-6 shrink-0 overflow-hidden rounded">
            <img
              src={channelBadge.logo}
              alt={channelBadge.name}
              className="size-full object-cover"
            />
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
      {voiceMeta && conversationId != null ? (
        <VoiceMessageCapsule
          messageId={message.id}
          conversationId={conversationId}
          meta={voiceMeta}
          transcript={copyText}
        />
      ) : (
        <MessageContent className="w-auto">{messageBody}</MessageContent>
      )}
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

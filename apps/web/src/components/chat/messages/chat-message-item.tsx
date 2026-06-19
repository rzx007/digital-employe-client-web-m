import * as React from "react"
import type { UIMessage } from "ai"
import { IconClipboardList } from "@tabler/icons-react"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import { Spinner } from "@/components/spinner"
import { getCopyableMessageText, getTextFromUIMessage } from "@/lib/chat/message-utils"
import {
  assistantMessageHasVisibleBody,
  isGroupTimelineAssistantMessage,
} from "@/lib/chat/group-composer-ghosts"
import { getDispatchBadge } from "@/lib/chat/assistant-stream-state"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { UserAvatar } from "@/components/user-avatar"
import { useAuthStore } from "@/stores/auth-store"
import { cn } from "@workspace/ui/lib/utils"
import {
  resolveHitlApproveMessageId,
  type ActiveHitl,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"
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

  // 群时间线进行中消息（组长/成员逐字流式临时态）：用流式光标传达「还在打字」，
  // 不显示字数（无品）。仅作为「是否在流式」的标记，门控占位/光标/动作区显示。
  const groupStreaming = React.useMemo(() => {
    if (contact.type !== "group" || message.role !== "assistant") return null
    const meta = (message as { metadata?: Record<string, unknown> }).metadata
    if (!meta || meta.streamState !== "streaming") return null
    return true
  }, [contact.type, message])

  // 自动派单的首条 user 消息：后端 extra_meta 标记，邮戳与真人消息区分。
  const dispatchBadge = React.useMemo(() => {
    if (message.role !== "user") return null
    return getDispatchBadge(
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

  const groupStreamingAwaitingFirstToken =
    groupStreaming != null && classifiedBlocks.length === 0

  const groupTimelineFallbackText = React.useMemo(() => {
    if (contact.type !== "group" || message.role !== "assistant") return null
    const text = getTextFromUIMessage(deferredMessage).trim()
    if (text) return text
    const meta = (message as { metadata?: Record<string, unknown> }).metadata
    if (meta?.clarify_message_id != null) {
      return "组长需要确认一些信息，请在下方输入框回答。"
    }
    return null
  }, [contact.type, deferredMessage, message])

  // 群 composer 残留空 assistant（无发言人、无正文）→ 不渲染，避免「群拼图/空气泡」。
  if (
    contact.type === "group" &&
    message.role === "assistant" &&
    !groupStreaming &&
    classifiedBlocks.length === 0 &&
    !isGroupTimelineAssistantMessage(message) &&
    !assistantMessageHasVisibleBody(message)
  ) {
    return null
  }

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
      ) : groupStreamingAwaitingFirstToken ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner
            className="size-3.5 shrink-0"
            style={{ color: "#8B5CF6" }}
          />
          <Shimmer className="text-xs">正在生成回复...</Shimmer>
        </div>
      ) : groupTimelineFallbackText ? (
        <MessageResponse>{groupTimelineFallbackText}</MessageResponse>
      ) : (
        <MessageResponse />
      )}
      {groupStreaming && !groupStreamingAwaitingFirstToken ? (
        // 流式光标：跟在已生成文本末尾轻微闪烁，传达「还在打字」。
        <span
          aria-hidden
          className="ml-0.5 inline-block h-3.5 w-[2px] -translate-y-px animate-pulse rounded-full bg-primary/70 align-middle"
        />
      ) : null}
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
              const senderRole =
                typeof meta?.role === "string" ? meta.role : undefined
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
              // 组长：role==="leader" 或回退老逻辑 senderName==="组长"。
              // 金环头像 + 「组长」徽标，给协调者在群里清晰的身份感。
              if (senderRole === "leader" || senderName === "组长") {
                return (
                  <div className="flex items-center gap-1.5">
                    <EmployeeContactAvatar
                      name="组长"
                      avatar={CURATOR_AVATAR_URL}
                      avatarClassName="size-6 ring-2 ring-amber-300/60"
                      fallbackClassName="text-[10px]"
                    />
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      组长
                    </span>
                  </div>
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
          {(() => {
            if (contact.type !== "group") {
              return (
                <span className="text-xs text-muted-foreground">
                  {contactDisplayName}
                </span>
              )
            }
            const meta = (
              message as { metadata?: Record<string, unknown> }
            ).metadata
            const s =
              typeof meta?.senderName === "string" ? meta.senderName : undefined
            const senderRole =
              typeof meta?.role === "string" ? meta.role : undefined
            // 组长头像块已自带「组长」徽标，这里不再重复显示名字（否则「组长 组长」）。
            if (senderRole === "leader" || s === "组长") return null
            return (
              <span className="text-xs text-muted-foreground">
                {s || contactDisplayName}
              </span>
            )
          })()}
        </div>
      )}
      {message.role === "user" && !dispatchBadge && (
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
      {groupStreaming ? null : message.role === "assistant" ? (
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

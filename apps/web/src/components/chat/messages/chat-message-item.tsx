import * as React from "react"
import type { UIMessage } from "ai"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { getCopyableMessageText } from "@/lib/chat/message-utils"
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

  return (
    <Message from={message.role} className={cn("group mx-auto max-w-4xl")}>
      {message.role === "assistant" && (
        <div className="mb-2 flex items-center gap-2">
          {contact.type === "group" ? (
            <GroupMembersAvatar
              participants={contact.group?.participants}
              className="size-6"
              itemClassName="h-3 w-3"
              fallbackClassName="text-[8px]"
              placeholderClassName="h-3 w-3"
            />
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
            {contactDisplayName}
          </span>
        </div>
      )}
      <MessageContent className="w-auto">
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
        </div>
      </MessageContent>
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

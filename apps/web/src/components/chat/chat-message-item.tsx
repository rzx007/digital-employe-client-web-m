import * as React from "react"
import type { UIMessage } from "ai"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { classifyMessageParts } from "@/lib/chat/message-utils"
import { FileChangeCards } from "./file-change-cards"
import { ThinkingBlock } from "./thinking-block"
import { ToolGroupBlock } from "./tool-group-block"
import { PlanGeneratedCard } from "./plan-generated-card"
import { SkillExplorationBlock } from "./skill-exploration-block"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import {
  getContactDisplayName,
  getMessageMeta,
  type ChatViewContact,
  type CommandMeta,
  type MentionMeta,
} from "./chat-view-shared"
import type {
  ClassifiedBlock,
} from "@/lib/chat/message-classifier"

function MessageMetaBadges({
  commandMeta,
  mentionMeta,
  messageId,
}: {
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  messageId: string
}) {
  if (!commandMeta?.title && mentionMeta.length === 0) return null
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {commandMeta?.title && (
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
          /{commandMeta.title}
        </span>
      )}
      {mentionMeta.map((mention, index) => (
        <span
          key={mention.id ?? `${messageId}:mention:${index}`}
          className="rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600"
        >
          @{mention.name ?? "unknown"}
        </span>
      ))}
    </div>
  )
}

export function RenderClassifiedBlocks({
  blocks,
  commandMeta,
  mentionMeta,
  messageId,
}: {
  blocks: ClassifiedBlock[]
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  messageId: string
}) {
  return (
    <>
      {blocks.map((block) => {
        if (block.kind === "tool-group") {
          return (
            <ToolGroupBlock
              block={block}
              className="w-full"
              key={block.key}
            />
          )
        }
        if (block.kind === "plan-generated") {
          return (
            <PlanGeneratedCard
              input={block.input}
              state={block.state}
              className="w-full"
              key={block.key}
            />
          )
        }
        if (block.kind === "file-changes") {
          return <FileChangeCards files={block.files} key={block.key} />
        }
        if (block.kind === "skill-exploration") {
          return (
            <SkillExplorationBlock
              items={block.items}
              thinkingText={block.thinkingText}
              className="w-full"
              key={block.key}
            />
          )
        }
        if (block.kind === "thinking") {
          return (
            <ThinkingBlock
              className="w-full"
              key={block.key}
              text={block.text}
            />
          )
        }
        return (
          <div
            className="flex w-full items-center space-x-2"
            key={block.key}
          >
            <MessageMetaBadges
              commandMeta={commandMeta}
              mentionMeta={mentionMeta}
              messageId={messageId}
            />
            <MessageResponse className="flex-1">{block.text}</MessageResponse>
          </div>
        )
      })}
    </>
  )
}

export interface ChatMessageItemProps {
  message: UIMessage
  contact: ChatViewContact
  includeFileChanges: boolean
}

function ChatMessageItemInner({ message, contact, includeFileChanges }: ChatMessageItemProps) {
  const contactDisplayName = getContactDisplayName(contact)
  const classifiedBlocks = React.useMemo(
    () => classifyMessageParts(message, { includeFileChanges }),
    [message, includeFileChanges]
  )

  const messageMeta = React.useMemo(
    () => getMessageMeta(message),
    [message]
  )
  const commandMeta = (
    messageMeta?.command &&
    typeof messageMeta.command === "object"
  )
    ? (messageMeta.command as { id?: string; title?: string })
    : null
  const mentionMeta = (
    messageMeta?.mentions &&
    Array.isArray(messageMeta.mentions)
  )
    ? messageMeta.mentions
    : []

  return (
    <Message
      from={message.role}
      className="mx-auto max-w-4xl"
    >
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
        <div className="space-y-3">
          {classifiedBlocks.length > 0 ? (
            <RenderClassifiedBlocks
              blocks={classifiedBlocks}
              commandMeta={commandMeta}
              mentionMeta={mentionMeta}
              messageId={message.id}
            />
          ) : (
            <MessageResponse />
          )}
        </div>
      </MessageContent>
    </Message>
  )
}

export const ChatMessageItem = React.memo(ChatMessageItemInner)

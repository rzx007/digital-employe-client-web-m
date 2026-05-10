import * as React from "react"
import type { UIMessage } from "ai"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { IconAlertTriangle, IconFile } from "@tabler/icons-react"
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
  type FileMeta,
  type MentionMeta,
} from "./chat-view-shared"
import type {
  ClassifiedBlock,
} from "@/lib/chat/message-classifier"

function MessageMetaBadges({
  commandMeta,
  mentionMeta,
  filesMeta,
  messageId,
}: {
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  filesMeta?: FileMeta
  messageId: string
}) {
  if (!commandMeta?.title && mentionMeta.length === 0 && !filesMeta?.length) return null
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
      {filesMeta?.map((file, index) => (
        <span
          key={`${messageId}:file:${index}`}
          className="inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600"
        >
          <IconFile className="size-3" />
          {file.name}
        </span>
      ))}
    </div>
  )
}

export function RenderClassifiedBlocks({
  blocks,
  commandMeta,
  mentionMeta,
  filesMeta,
  messageId,
}: {
  blocks: ClassifiedBlock[]
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  filesMeta?: FileMeta
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
        if (block.kind === "error") {
          return (
            <div
              className="w-full rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
              key={block.key}
            >
              <div className="mb-1.5 flex items-center gap-2 text-destructive">
                <IconAlertTriangle className="size-4 shrink-0" />
                <span className="text-sm font-semibold">请求出错</span>
              </div>
              <pre className="whitespace-pre-wrap break-all font-mono text-xs text-destructive/80">
                {block.text}
              </pre>
            </div>
          )
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
            className="flex w-full items-start space-x-2"
            key={block.key}
          >
            <MessageMetaBadges
              commandMeta={commandMeta}
              mentionMeta={mentionMeta}
              filesMeta={filesMeta}
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
  const filesMeta = (
    messageMeta?.files &&
    Array.isArray(messageMeta.files)
  )
    ? messageMeta.files
    : undefined

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
              filesMeta={filesMeta}
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

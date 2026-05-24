import * as React from "react"
import type { UIMessage } from "ai"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { getCopyableMessageText } from "@/lib/chat/message-utils"
import { IconAlertTriangle, IconFile } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { classifyMessageParts } from "@/lib/chat/message-utils"
import { FileChangeCards } from "../message-blocks/file-change-cards"
import { ThinkingBlock } from "../message-blocks/thinking-block"
import { ToolGroupBlock } from "../message-blocks/tool-group-block"
import { TodoPlanBlock } from "../message-blocks/todo-plan-block"
import { PlanGeneratedCard } from "../message-blocks/plan-generated-card"
import {
  isHitlAbortedOutput,
  resolveHitlApproveMessageId,
  type HitlPatchOptions,
} from "@/lib/chat/hitl-abort-message-utils"
import { DocumentPlanCard } from "../message-blocks/document-plan-card"
import { ClarifyingAnswersSummary } from "../message-blocks/clarifying-answers-summary"
import { RecruitmentCandidatesCard } from "../message-blocks/recruitment-candidates-card"
import { EmployeeHiredCard } from "../message-blocks/employee-hired-card"
import { SkillExplorationBlock } from "../message-blocks/skill-exploration-block"
import { SummarizationCheckpointBlock } from "../message-blocks/summarization-checkpoint-block"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "../contacts/contact-avatars"
import {
  getContactDisplayName,
  getElapsedMsFromMeta,
  getMessageMeta,
  type ChatViewContact,
  type CommandMeta,
  type FileMeta,
  type MentionMeta,
} from "../shared/chat-view-shared"
import { MessageAssistantActions } from "./message-assistant-actions"
import { MessageCopyAction } from "./message-copy-action"
import type { ClassifiedBlock } from "@/lib/chat/message-classifier"
import { computeToolAutoCollapseMap } from "@/lib/chat/tool-collapse-policy"

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
  if (!commandMeta?.title && mentionMeta.length === 0 && !filesMeta?.length)
    return null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
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
  toolAutoCollapseMap,
  isLastAssistantMessage = false,
  isTurnEnded = true,
  conversationId,
  onHitlApproved,
}: {
  blocks: ClassifiedBlock[]
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  filesMeta?: FileMeta
  messageId: string
  toolAutoCollapseMap: Map<string, boolean>
  isLastAssistantMessage?: boolean
  isTurnEnded?: boolean
  conversationId?: string | number | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
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
              toolAutoCollapseMap={toolAutoCollapseMap}
            />
          )
        }
        if (block.kind === "todo-plan") {
          return (
            <TodoPlanBlock
              key={block.key}
              tool={block.tool}
              todos={block.todos}
              className="w-full"
              sticky={isLastAssistantMessage && !isTurnEnded}
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
        if (block.kind === "document-plan") {
          return (
            <DocumentPlanCard
              key={block.key}
              input={block.input}
              state={
                block.resultText && !isHitlAbortedOutput(block.resultText)
                  ? "output-available"
                  : block.state
              }
              resultText={block.resultText}
              conversationId={conversationId}
              messageId={messageId}
              toolCallId={block.toolCallId}
              onHitlApproved={onHitlApproved}
              className="w-full"
            />
          )
        }
        if (block.kind === "clarifying-answers") {
          return (
            <ClarifyingAnswersSummary
              key={block.key}
              items={block.items}
              className="w-full"
            />
          )
        }
        if (block.kind === "recruitment-candidates") {
          return (
            <RecruitmentCandidatesCard
              key={block.key}
              state={block.state}
              resultText={block.resultText}
              className="w-full"
            />
          )
        }
        if (block.kind === "employee-hired") {
          return (
            <EmployeeHiredCard
              key={block.key}
              state={block.state}
              resultText={block.resultText}
              celebrateOnSuccess={isLastAssistantMessage}
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
              <pre className="font-mono text-xs break-all whitespace-pre-wrap text-destructive/80">
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
        if (block.kind === "summarization-checkpoint") {
          return (
            <SummarizationCheckpointBlock
              text={block.text}
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
            className="flex w-full min-w-0 flex-wrap items-start gap-2"
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
  /** 是否为列表中最后一条 assistant（当前流式轮） */
  isLastAssistantMessage?: boolean
  /** 本轮是否已结束（status ready/error），末项工具据此延迟收起 */
  isTurnEnded?: boolean
  conversationId?: string | number | null
  hitlMessageId?: string | null
  onHitlApproved?: (options?: HitlPatchOptions) => void
}

function ChatMessageItemInner({
  message,
  contact,
  includeFileChanges,
  isLastAssistantMessage = false,
  isTurnEnded = true,
  conversationId,
  hitlMessageId,
  onHitlApproved,
}: ChatMessageItemProps) {
  const contactDisplayName = getContactDisplayName(contact)
  const deferredMessage = React.useDeferredValue(message)
  const classifiedBlocks = React.useMemo(
    () => classifyMessageParts(deferredMessage, { includeFileChanges }),
    [deferredMessage, includeFileChanges]
  )
  // 按同条消息内 tool-group 顺序 + 是否当前轮/回合是否结束，计算各 ToolRow 何时应收起
  const toolAutoCollapseMap = React.useMemo(
    () =>
      computeToolAutoCollapseMap(classifiedBlocks, {
        isLastAssistantMessage,
        isTurnEnded,
      }),
    [classifiedBlocks, isLastAssistantMessage, isTurnEnded]
  )

  const messageMeta = React.useMemo(
    () => getMessageMeta(deferredMessage),
    [deferredMessage]
  )
  const commandMeta =
    messageMeta?.command && typeof messageMeta.command === "object"
      ? (messageMeta.command as { id?: string; title?: string })
      : null
  const mentionMeta =
    messageMeta?.mentions && Array.isArray(messageMeta.mentions)
      ? messageMeta.mentions
      : []
  const filesMeta =
    messageMeta?.files && Array.isArray(messageMeta.files)
      ? messageMeta.files
      : undefined
  const elapsedMs = getElapsedMsFromMeta(deferredMessage)
  const copyText = React.useMemo(
    () => getCopyableMessageText(deferredMessage, { includeFileChanges }),
    [deferredMessage, includeFileChanges]
  )
  const hitlApproveMessageId = React.useMemo(
    () => resolveHitlApproveMessageId(message, hitlMessageId),
    [message, hitlMessageId]
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
            <RenderClassifiedBlocks
              blocks={classifiedBlocks}
              commandMeta={commandMeta}
              mentionMeta={mentionMeta}
              filesMeta={filesMeta}
              messageId={hitlApproveMessageId}
              toolAutoCollapseMap={toolAutoCollapseMap}
              isLastAssistantMessage={isLastAssistantMessage}
              isTurnEnded={isTurnEnded}
              conversationId={conversationId}
              onHitlApproved={onHitlApproved}
            />
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

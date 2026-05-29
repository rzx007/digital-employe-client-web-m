import type { ClassifiedBlock } from "@/lib/chat/message-classifier"
import { ToolGroupBlock } from "./tool-group-block"
import { TodoPlanBlock } from "./todo-plan-block"
import { PlanGeneratedCard } from "./plan-generated-card"
import { DocumentPlanCard } from "./document-plan-card"
import { ClarifyingAnswersSummary } from "./clarifying-answers-summary"
import { DocumentPlanApprovedSummary } from "./document-plan-approved-summary"
import { RecruitmentCandidatesCard } from "./recruitment-candidates-card"
import { EmployeeHiredCard } from "./employee-hired-card"
import { EmployeesHiredBatchCard } from "./employees-hired-batch-card"
import {
  EmployeeDeletedCard,
  EmployeeDetailCard,
  EmployeeUpdatedCard,
} from "./employee-crud-result-card"
import { TasksDeletedBatchCard } from "./tasks-deleted-batch-card"
import { FileChangeCards } from "./file-change-cards"
import { SkillExplorationBlock } from "./skill-exploration-block"
import { SummarizationCheckpointBlock } from "./summarization-checkpoint-block"
import { ThinkingBlock } from "./thinking-block"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import { IconAlertTriangle, IconFile } from "@tabler/icons-react"
import { isHitlAbortedOutput, type HitlPatchOptions } from "@/lib/chat/hitl"
import type { CommandMeta, FileMeta, MentionMeta } from "../shared/chat-view-shared"

export interface BlockRenderContext {
  messageId: string | null
  conversationId?: string | number | null
  toolAutoCollapseMap: Map<string, boolean>
  isLastAssistantMessage: boolean
  isTurnEnded: boolean
  onHitlApproved?: (options?: HitlPatchOptions) => void
  commandMeta: CommandMeta
  mentionMeta: MentionMeta
  filesMeta?: FileMeta
}

export function MessageMetaBadges({
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

export function BlockRenderer({
  block,
  ctx,
}: {
  block: ClassifiedBlock
  ctx: BlockRenderContext
}) {
  const {
    messageId,
    conversationId,
    toolAutoCollapseMap,
    isLastAssistantMessage,
    isTurnEnded,
    onHitlApproved,
    commandMeta,
    mentionMeta,
    filesMeta,
  } = ctx

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
        outputError={block.outputError}
        className="w-full"
      />
    )
  }
  if (block.kind === "document-plan-approved") {
    return (
      <DocumentPlanApprovedSummary
        key={block.key}
        resultText={block.resultText}
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
  if (block.kind === "employees-hired") {
    return (
      <EmployeesHiredBatchCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        celebrateOnSuccess={isLastAssistantMessage}
        className="w-full"
      />
    )
  }
  if (block.kind === "employee-detail") {
    return (
      <EmployeeDetailCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        className="w-full"
      />
    )
  }
  if (block.kind === "employee-updated") {
    return (
      <EmployeeUpdatedCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        className="w-full"
      />
    )
  }
  if (block.kind === "employee-deleted") {
    return (
      <EmployeeDeletedCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        className="w-full"
      />
    )
  }
  if (block.kind === "tasks-deleted") {
    return (
      <TasksDeletedBatchCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        className="w-full"
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
        messageId={messageId ?? ""}
      />
      <MessageResponse className="flex-1">{block.text}</MessageResponse>
    </div>
  )
}

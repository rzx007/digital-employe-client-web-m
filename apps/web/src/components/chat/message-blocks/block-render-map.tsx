import type { ClassifiedBlock } from "@/lib/chat/message-classifier"
import { OrchestratorTaskSummaryCard } from "./orchestrator-task-summary-card"
import { ToolGroupBlock } from "./tool-group-block"
import { TodoPlanBlock } from "./todo-plan-block"
import { PlanGeneratedCard } from "./plan-generated-card"
import { DocumentPlanCard } from "./document-plan-card"
import { BugReportCard } from "./bug-report-card"
import { ClarifyingAnswersSummary } from "./clarifying-answers-summary"
import { DocumentPlanApprovedSummary } from "./document-plan-approved-summary"
import { RecruitmentCandidatesCard } from "./recruitment-candidates-card"
import { EmployeeHiredCard } from "./employee-hired-card"
import { EmployeesHiredBatchCard } from "./employees-hired-batch-card"
import { GroupCreatedCard } from "./group-created-card"
import {
  EmployeeDeletedCard,
  EmployeeDetailCard,
  EmployeeUpdatedCard,
} from "./employee-crud-result-card"
import { TasksDeletedBatchCard } from "./tasks-deleted-batch-card"
import { EmployeesDismissedBatchCard } from "./employees-dismissed-batch-card"
import { UserActionSummaryCard } from "./user-action-summary-card"
import { DestructiveDeleteConfirmCard } from "./destructive-delete-confirm-card"
import { FileChangeCards } from "./file-change-cards"
import { DraftSkillSaveCard } from "./draft-skill-save-card"
import { FinalResponseContent } from "./artifact-path-chip"
import { SkillExplorationBlock } from "./skill-exploration-block"
import { SummarizationCheckpointBlock } from "./summarization-checkpoint-block"
import { ThinkingBlock } from "./thinking-block"
import { cn } from "@workspace/ui/lib/utils"
import { IconAlertTriangle, IconFile } from "@tabler/icons-react"
import { useCuratorFile } from "@/components/chat/curator/use-curator-file"
import {
  isDestructiveDeleteRejected,
  isHitlAbortedOutput,
  type HitlPatchOptions,
} from "@/lib/chat/hitl"
import { normalizeToolFilePath } from "@/lib/chat/pending-resources/paths"
import { useArtifactStore } from "@/stores/artifact-store"
import type {
  CommandMeta,
  FileMeta,
  MentionMeta,
} from "../shared/chat-view-shared"

export interface BlockRenderContext {
  messageId: string | null
  conversationId?: string | number | null
  /**
   * 该消息所属编排计划/执行的**源会话** id（群里组长计划存在 leader 会话、不是群会话）。
   * plan-generated 卡用它查计划真实状态——否则群卡用群会话 id 查不到 leader 的计划，
   * remoteStatus 永远 null → 「确认执行」按钮永不消失、执行中仍显示可确认。
   */
  planConversationId?: string | number | null
  toolAutoCollapseMap: Map<string, boolean>
  isLastAssistantMessage: boolean
  isTurnEnded: boolean
  onHitlApproved?: (options?: HitlPatchOptions) => void
  onSendUserMessage?: (text: string) => Promise<void>
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
  const openResource = useArtifactStore((s) => s.openResource)
  const curatorFile = useCuratorFile()
  const handleOpenFile = curatorFile?.onOpenFile ?? openResource

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
      {filesMeta?.map((file, index) => {
        const fileKey = `${messageId}:file:${index}`
        const badgeClassName = cn(
          "inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600",
          file.path &&
            "cursor-pointer transition-colors hover:bg-green-500/20 hover:underline"
        )
        if (!file.path) {
          return (
            <span key={fileKey} className={badgeClassName}>
              <IconFile className="size-3" />
              {file.name}
            </span>
          )
        }
        return (
          <button
            key={fileKey}
            type="button"
            className={badgeClassName}
            title={file.path}
            onClick={() => handleOpenFile(normalizeToolFilePath(file.path))}
          >
            <IconFile className="size-3" />
            {file.name}
          </button>
        )
      })}
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
    planConversationId,
    toolAutoCollapseMap,
    isLastAssistantMessage,
    isTurnEnded,
    onHitlApproved,
    onSendUserMessage,
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
        resultText={block.resultText}
        conversationId={planConversationId ?? conversationId}
        isTurnEnded={isTurnEnded}
        onSendUserMessage={onSendUserMessage}
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
  if (block.kind === "bug-report") {
    return (
      <BugReportCard
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
  if (block.kind === "destructive-delete") {
    return (
      <DestructiveDeleteConfirmCard
        key={block.key}
        toolName={block.toolName}
        input={block.input}
        state={
          block.resultText && !isDestructiveDeleteRejected(block.resultText)
            ? "output-available"
            : block.state
        }
        resultText={block.resultText}
        conversationId={conversationId}
        messageId={messageId}
        onHitlApproved={onHitlApproved}
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
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
        celebrateOnSuccess={isLastAssistantMessage}
        className="w-full"
      />
    )
  }
  if (block.kind === "group-created") {
    return (
      <GroupCreatedCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
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
        preliminary={block.preliminary}
        className="w-full"
      />
    )
  }
  if (block.kind === "employees-dismissed") {
    return (
      <EmployeesDismissedBatchCard
        key={block.key}
        state={block.state}
        resultText={block.resultText}
        preliminary={block.preliminary}
        className="w-full"
      />
    )
  }
  if (block.kind === "user-action-summary") {
    return (
      <UserActionSummaryCard
        key={block.key}
        text={block.text}
        uiAction={block.uiAction}
        className="w-full"
      />
    )
  }
  if (block.kind === "file-changes") {
    return <FileChangeCards files={block.files} key={block.key} />
  }
  if (block.kind === "draft-skill-save") {
    return (
      <DraftSkillSaveCard
        key={block.key}
        skillName={block.skillName}
        skillPath={block.skillPath}
        className="w-full"
      />
    )
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
      <ThinkingBlock className="w-full" key={block.key} text={block.text} />
    )
  }
  if (block.kind === "orchestrator-task-summary") {
    return (
      <OrchestratorTaskSummaryCard
        key={block.key}
        heading={block.heading}
        body={block.body}
        runStatus={block.runStatus}
        employeeConversationId={block.employeeConversationId}
        className="w-full"
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
      <FinalResponseContent
        className="flex-1"
        conversationId={conversationId}
        text={block.text}
      />
    </div>
  )
}

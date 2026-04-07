import * as React from "react"
import {
  IconChevronDown,
  IconChevronRight,
  IconCirclePlus,
  IconExternalLink,
  IconHistory,
  IconMaximize,
  IconMinimize,
} from "@tabler/icons-react"
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@workspace/ui/components/ai-elements/message"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { TaskExecution } from "@/types/schedule-monitor"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { Spinner } from "@/components/spinner"
import { ChatPromptInput } from "../chat-prompt-input"
import type { PromptChangeEvent } from "../lexical-editor/prompt-input-textarea"
import type { ChatViewContact } from "./chat-view-shared"
import { EmployeeContactAvatar } from "./contact-avatars"
import type { AIEmployee } from "@/lib/mock-data/ai-employees"
import { Button } from "@workspace/ui/components/button"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  success: {
    label: "成功",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  },
  failed: {
    label: "失败",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
  pending: {
    label: "待执行",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  },
  running: {
    label: "执行中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
  timeout: {
    label: "超时",
    className:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  },
  stuck: {
    label: "卡死",
    className:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  },
}

const SUMMARY_MAX_LENGTH = 200

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function parseExecutionMessage(msg: string): string {
  const match = msg.match(/^content='((?:[^'\\]|\\.)*)'/)
  if (match) {
    let content = match[1]
    content = content.replace(/\\n/g, "\n")
    content = content.replace(/\\r/g, "\r")
    content = content.replace(/\\t/g, "\t")
    content = content.replace(/\\'/g, "'")
    content = content.replace(/\\\\/g, "\\")
    return content
  }
  return msg.replace(/\r\n/g, "\n").trim()
}

function getResultText(execution: TaskExecution): string {
  if (execution.output?.response?.messages?.length) {
    return execution.output.response.messages
      .map(parseExecutionMessage)
      .join("\n\n")
  }
  return execution.run_result ?? ""
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "..."
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return format(d, "HH:mm:ss", { locale: zhCN })
}

function ExecutionDetailDialog({
  execution,
  open,
  onOpenChange,
}: {
  execution: TaskExecution
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const config = STATUS_CONFIG[execution.run_status] ?? STATUS_CONFIG.pending
  const resultText = getResultText(execution)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          isFullscreen
            ? "fixed inset-0 z-50 h-full w-screen! max-w-screen! translate-x-0 translate-y-0 rounded-none"
            : "max-w-2xl!"
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="truncate">{execution.task_name}</span>
            <Badge
              variant="outline"
              className={cn("px-1.5 py-0 text-[10px]", config.className)}
            >
              {config.label}
            </Badge>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto shrink-0 rounded-sm hover:bg-accent"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? (
                <IconMinimize className="size-3.5" />
              ) : (
                <IconMaximize className="size-3.5" />
              )}
            </Button>
            <span className="mr-5 text-xs text-muted-foreground">
              {formatDuration(execution.duration_ms)} ·{" "}
              {formatTime(execution.started_at)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <div
          className={cn(
            "-mx-4 overflow-auto px-4",
            isFullscreen ? "h-[calc(100vh-5rem)]" : "max-h-[60vh]"
          )}
        >
          <div className="space-y-4">
            {resultText && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  执行结果
                </p>
                <MessageResponse className="text-sm">
                  {resultText}
                </MessageResponse>
              </div>
            )}

            {execution.error_message && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  错误信息
                </p>
                <p className="text-sm leading-relaxed text-red-600/80 dark:text-red-400/80">
                  {execution.error_message}
                </p>
              </div>
            )}

            {!resultText && !execution.error_message && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                暂无详细信息
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ExecutionCard({ execution }: { execution: TaskExecution }) {
  const [expanded, setExpanded] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const config = STATUS_CONFIG[execution.run_status] ?? STATUS_CONFIG.pending
  const resultText = getResultText(execution)
  const isTruncated = resultText.length > SUMMARY_MAX_LENGTH
  const summaryText = truncateText(resultText, SUMMARY_MAX_LENGTH)

  return (
    <>
      <div className="rounded-lg border bg-card">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs font-medium">
            {execution.task_name}
          </span>
          <Badge
            variant="outline"
            className={cn("shrink-0 px-1.5 py-0 text-[10px]", config.className)}
          >
            {config.label}
          </Badge>
          <span
            className={cn(
              "shrink-0 text-[10px] tabular-nums",
              execution.duration_ms != null && execution.duration_ms >= 30000
                ? "text-red-500"
                : "text-muted-foreground"
            )}
          >
            {formatDuration(execution.duration_ms)}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {formatTime(execution.started_at)}
          </span>
        </button>

        {expanded && (
          <div className="space-y-1.5 border-t px-3 py-2">
            {resultText && (
              <div className="rounded bg-muted/50 p-2">
                <p className="mb-1 text-[10px] font-medium text-muted-foreground">
                  执行结果
                </p>
                <MessageResponse className="text-[10px]">
                  {summaryText}
                </MessageResponse>
                {isTruncated && (
                  <button
                    type="button"
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-primary hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDetailOpen(true)
                    }}
                  >
                    <IconExternalLink className="size-3" />
                    查看详情
                  </button>
                )}
              </div>
            )}

            {!resultText && execution.error_message && (
              <div className="rounded bg-red-50 p-2 dark:bg-red-950/30">
                <p className="mb-1 text-[10px] font-medium text-red-600 dark:text-red-400">
                  错误信息
                </p>
                <p className="text-[10px] leading-relaxed text-red-600/80 dark:text-red-400/80">
                  {execution.error_message}
                </p>
              </div>
            )}

            {!resultText && !execution.error_message && (
              <p className="py-1 text-center text-[10px] text-muted-foreground">
                暂无详细信息
              </p>
            )}
          </div>
        )}
      </div>

      <ExecutionDetailDialog
        execution={execution}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  )
}

export function CuratorView({
  contact,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const { data: executions = [], isPending } = useAllTaskExecutions()
  const contacts = useChatStore((s) => s.contacts)
  const openMonitor = useMonitorStore((s) => s.openMonitor)

  const employeeMap = React.useMemo(() => {
    const map = new Map<string, AIEmployee>()
    for (const c of contacts) {
      if (c.type === "employee" && c.employee) {
        map.set(c.employee.id, c.employee)
      }
    }
    return map
  }, [contacts])

  const sortedExecutions = React.useMemo(() => {
    return [...executions].sort(
      (a, b) =>
        new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    )
  }, [executions])

  const formatTimeHeader = React.useCallback((iso: string) => {
    return format(new Date(iso), "HH:mm", { locale: zhCN })
  }, [])

  const handleInputChange = React.useCallback((_event: PromptChangeEvent) => {
    void _event
  }, [])

  const handleSend = React.useCallback(async () => {
    void 0
  }, [])

  return (
    <div
      className={cn("flex flex-1 flex-col bg-background", className)}
      {...props}
    >
      <div className="flex items-center justify-between border-b px-6 py-3">
        {contact?.type === "curator" && (
          <div className="flex items-center gap-3">
            <EmployeeContactAvatar
              name={contact.curator?.name}
              avatar={contact.curator?.avatar}
              status={contact.curator?.status}
              showStatus
            />
            <div className="flex min-w-0 flex-col">
              <h3 className="truncate text-sm font-medium">任务执行结果</h3>
              <p className="truncate text-xs text-muted-foreground">
                全部员工的实时执行记录
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center gap-1">
          {onNewConversation && (
            <Button variant="ghost" size="icon-sm" onClick={onNewConversation}>
              <IconCirclePlus className="size-4" />
            </Button>
          )}
          {onOpenConversations && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenConversations}
            >
              <IconHistory className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <Conversation className="min-h-0 flex-1 overflow-y-auto pt-4">
        <ConversationContent>
          {isPending && (
            <div className="flex items-center justify-center py-16">
              <Spinner className="size-5" />
            </div>
          )}

          {!isPending && sortedExecutions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <p className="text-xs">暂无执行记录</p>
            </div>
          )}

          {sortedExecutions.map((execution) => {
            const employee = employeeMap.get(String(execution.employee_id))
            return (
              <Message key={execution.id} from="assistant">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full transition-all hover:ring-2 hover:ring-primary/30"
                    onClick={() =>
                      openMonitor(
                        String(execution.employee_id),
                        employee?.name ?? ""
                      )
                    }
                  >
                    <EmployeeContactAvatar
                      name={employee?.name ?? String(execution.employee_id)}
                      avatar={employee?.avatar}
                      status={employee?.status}
                      avatarClassName="size-6"
                      fallbackClassName="text-[10px]"
                    />
                  </button>
                  <span className="text-xs font-medium text-muted-foreground">
                    {employee?.name ?? `员工 #${execution.employee_id}`}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">
                    {formatTimeHeader(execution.started_at)}
                  </span>
                </div>
                <MessageContent>
                  <ExecutionCard execution={execution} />
                </MessageContent>
              </Message>
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="border-t p-4">
        <ChatPromptInput
          value=""
          onChange={handleInputChange}
          onSubmit={handleSend}
          status="ready"
          disabled={true}
          size="compact"
          className="w-full overflow-hidden"
          slashCommands={[]}
        />
      </div>
    </div>
  )
}

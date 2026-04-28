import * as React from "react"
import {
  IconCirclePlus,
  IconHistory,
} from "@tabler/icons-react"
import {
  Conversation as ConversationUI,
  ConversationContent,
  ConversationScrollButton,
} from "@workspace/ui/components/ai-elements/conversation"
import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { Spinner } from "@/components/spinner"
import type { AIEmployee } from "@/lib/mock-data/ai-employees"
import type { ChatViewContact } from "../chat-view-shared"
import { EmployeeContactAvatar } from "../contact-avatars"
import { ExecutionCard } from "../execution-card"

export function CuratorMonitorView({
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

      <ConversationUI className="min-h-0 flex-1 overflow-y-auto pt-4">
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
            const convId = (execution as any).conversation_id
            return (
              <Message key={execution.id} from="assistant">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-full transition-all hover:ring-2 hover:ring-primary/30"
                    onClick={() => {
                      if (convId) {
                        useChatStore.getState().selectConversation(
                          useChatStore.getState().selectedContactId ?? "",
                          String(convId)
                        )
                      } else {
                        openMonitor(
                          String(execution.employee_id),
                          employee?.name ?? ""
                        )
                      }
                    }}
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
                  <ExecutionCard execution={execution} className="min-w-sm" />
                </MessageContent>
              </Message>
            )
          })}
        </ConversationContent>
        <ConversationScrollButton />
      </ConversationUI>
    </div>
  )
}

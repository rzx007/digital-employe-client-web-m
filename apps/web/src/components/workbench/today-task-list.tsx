import { useCallback, useMemo } from "react"
import { IconClock } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { TodayTask } from "@/types/schedule-monitor"
import { TaskStatusBadge } from "./task-status-badge"
import { navigateToEmployeeFromCurator } from "@/lib/chat/curator-navigation"
import { getContactId } from "@/lib/chat/contact-utils"
import { useChatStore } from "@/stores/chat-store"
import { selectConversationForContact } from "@/lib/chat/conversation-selection"

interface TodayTaskListProps {
  executions: TodayTask[]
  isLoading?: boolean
}

function formatTime(dateStr: string): string {
  if (!dateStr.trim()) return "--"
  const date = new Date(dateStr)
  if (Number.isNaN(date.getTime())) return "--"
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function TodayTaskList({ executions, isLoading }: TodayTaskListProps) {
  const openTaskConversation = useCallback(
    (task: TodayTask) => {
      if (task.conversation_id == null) return
      if (task.is_plan) {
        // plan 折叠行：切到总管联系人 + 选中本轮 curator 会话（不走员工深链）
        const state = useChatStore.getState()
        const curatorContact = state.contacts.find((c) => c.type === "curator")
        const curatorContactId = curatorContact ? getContactId(curatorContact) : null
        if (curatorContactId == null) return
        selectConversationForContact(curatorContactId, task.conversation_id)
        return
      }
      // 普通员工执行会话：用既有深链
      const state = useChatStore.getState()
      const curatorContact = state.contacts.find((c) => c.type === "curator")
      const curatorContactId = curatorContact ? getContactId(curatorContact) : null
      navigateToEmployeeFromCurator({
        curatorContactId: curatorContactId ?? "",
        curatorConversationId: state.workbenchCuratorConversationId ?? "",
        employeeId: String(task.employee_id),
        employeeConversationId: task.conversation_id,
      })
    },
    []
  )
  const sorted = useMemo(() => {
    return [...executions].sort((a, b) => {
      if (a.run_status === "running" && b.run_status !== "running") return -1
      if (b.run_status === "running" && a.run_status !== "running") return 1
      const at = a.started_at || a.planned_at || ""
      const bt = b.started_at || b.planned_at || ""
      return bt.localeCompare(at)
    })
  }, [executions])

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    )
  }

  if (executions.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        今日暂无任务执行
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 space-y-1.5">
      {sorted.map((task) => {
        const rowKey = task.is_plan
          ? `plan-${task.plan_id}`
          : task.task_id + (task.execution_id ? `-${task.execution_id}` : "")
        const canOpenChat = task.conversation_id != null
        const rowClassName = cn(
          "grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-0 rounded-md border p-2 transition-colors",
          task.run_status === "running" &&
            "border-blue-300 bg-blue-50/50 dark:bg-blue-950/20",
          canOpenChat && "cursor-pointer hover:bg-muted/40",
          !canOpenChat && "cursor-default"
        )

        const body = (
          <>
            <div className="min-w-0 overflow-hidden">
              {task.is_plan ? (
                <p
                  className="line-clamp-2 text-xs leading-snug font-medium break-words"
                  title={task.task_name}
                >
                  {task.task_name}
                </p>
              ) : (
                <div className="flex min-w-0 items-start gap-1.5 overflow-hidden">
                  <p
                    className="min-w-0 flex-1 line-clamp-2 text-xs leading-snug font-medium break-words"
                    title={task.task_name}
                  >
                    {task.task_name}
                  </p>
                  <span className="max-w-[5rem] shrink-0 truncate rounded bg-muted/70 px-1 py-px text-[10px] font-semibold text-foreground">
                    {task.employee_name}
                  </span>
                </div>
              )}
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                {task.is_plan && (
                  <span className="shrink-0 rounded bg-muted/70 px-1 py-px text-[10px] font-medium text-foreground/80">
                    编排计划
                    {task.run_seq != null && ` · 第${task.run_seq}轮`}
                  </span>
                )}
                <span className="flex shrink-0 items-center gap-0.5">
                  <IconClock className="size-2.5" />
                  {formatTime(task.started_at || task.planned_at || "")}
                </span>
                {task.duration_ms != null && (
                  <span className="shrink-0">
                    {formatDuration(task.duration_ms)}
                  </span>
                )}
              </div>
            </div>
            <TaskStatusBadge
              status={task.run_status}
              className="shrink-0 justify-self-end"
            />
          </>
        )

        if (canOpenChat) {
          return (
            <button
              key={rowKey}
              type="button"
              className={cn(rowClassName, "text-left")}
              onClick={() => openTaskConversation(task)}
            >
              {body}
            </button>
          )
        }

        return (
          <div key={rowKey} className={rowClassName}>
            {body}
          </div>
        )
      })}
    </div>
  )
}

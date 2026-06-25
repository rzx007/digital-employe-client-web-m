import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { ACTIVE_TASK_RUN_STATUSES } from "@/types/schedule-monitor"

/**
 * 内联「N 个任务在执行」指示条。
 * 有进行中任务时显示，count === 0 返回 null。
 * 点击打开员工任务面板。
 */
export function RunningTasksIndicator({
  curatorConversationId,
  onOpenEmployeeTasks,
  className,
}: {
  curatorConversationId: string | number | null
  onOpenEmployeeTasks?: () => void
  className?: string
}) {
  const { data: executions = [] } = useCuratorTaskExecutions(
    curatorConversationId
  )

  const count = executions.filter((e) =>
    ACTIVE_TASK_RUN_STATUSES.has(e.run_status)
  ).length

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={() => {
        if (onOpenEmployeeTasks) {
          onOpenEmployeeTasks()
          return
        }
        useEmployeeTasksPanelStore.getState().toggle()
      }}
      className={cn(
        "mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        "animate-in duration-200 fade-in slide-in-from-bottom-1",
        className
      )}
    >
      <IconLoader2 className="size-3 shrink-0 animate-spin" />
      <span>{count} 个任务在执行</span>
    </button>
  )
}

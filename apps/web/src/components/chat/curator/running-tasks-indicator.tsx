import { IconLoader2 } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import type { TaskRunStatus } from "@/types/schedule-monitor"

/** 与 employee-tasks-panel 「进行中」区保持完全一致的状态集合 */
const ACTIVE_STATUSES: ReadonlySet<TaskRunStatus> = new Set<TaskRunStatus>([
  "running",
  "queued",
  "pending",
  "stuck",
])

/**
 * 内联「N 个任务在执行」指示条。
 * 有进行中任务时显示，count === 0 返回 null。
 * 点击打开员工任务面板。
 */
export function RunningTasksIndicator({
  curatorConversationId,
  className,
}: {
  curatorConversationId: string | number | null
  className?: string
}) {
  const { data: executions = [] } = useCuratorTaskExecutions(
    curatorConversationId
  )

  const count = executions.filter((e) => ACTIVE_STATUSES.has(e.run_status))
    .length

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={() => useEmployeeTasksPanelStore.getState().open()}
      className={cn(
        "mx-auto flex w-fit items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <IconLoader2 className="size-3 shrink-0 animate-spin" />
      <span>{count} 个任务在执行</span>
    </button>
  )
}

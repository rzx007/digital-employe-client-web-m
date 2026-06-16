import { IconX } from "@tabler/icons-react"

import { cn } from "@workspace/ui/lib/utils"

import { ExecutionReportCard } from "@/components/chat/message-blocks/execution-report-card"
import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import {
  ACTIVE_TASK_RUN_STATUSES,
  type TaskExecution,
} from "@/types/schedule-monitor"

function isActiveExecution(exec: TaskExecution): boolean {
  return ACTIVE_TASK_RUN_STATUSES.has(exec.run_status)
}

/** 分区标题：进行中 / 已完成。 */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-1 pt-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground/60 uppercase first:pt-0">
      {children}
    </div>
  )
}

/**
 * 常驻「员工任务」面板 —— Claude-Code Background tasks 式。
 * 展示当前总管会话下发的员工任务（状态 + 结果），分进行中 / 已完成两区。
 * 数据走 `useCuratorTaskExecutions`（10s 轮询 + SSE invalidate 近实时）。
 */
export function EmployeeTasksPanel({
  curatorConversationId,
  curatorContactId,
  onClose,
  className,
}: {
  curatorConversationId: string | number | null
  curatorContactId?: string | null
  onClose: () => void
  className?: string
}) {
  const { data: executions = [], isPending } = useCuratorTaskExecutions(
    curatorConversationId
  )

  const running = executions.filter(isActiveExecution)
  const finished = executions.filter((e) => !isActiveExecution(e))
  const total = executions.length

  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden rounded-lg border bg-background shadow-xl",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <span className="flex shrink-0 items-center gap-2 text-sm font-semibold">
          员工任务
          {total > 0 ? (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
              {total}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconX className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {total === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {isPending ? "加载中…" : "暂无员工任务"}
            </p>
            {!isPending ? (
              <p className="mt-1 text-xs text-muted-foreground/70">
                总管派发任务后，员工的执行状态与结果会在这里展示
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            {running.length > 0 ? (
              <>
                <SectionLabel>进行中 · {running.length}</SectionLabel>
                <div className="space-y-2">
                  {running.map((exec) => (
                    <ExecutionReportCard
                      key={exec.id}
                      execution={exec}
                      curatorContactId={curatorContactId}
                      curatorConversationId={curatorConversationId}
                    />
                  ))}
                </div>
              </>
            ) : null}
            {finished.length > 0 ? (
              <>
                <SectionLabel>已完成 · {finished.length}</SectionLabel>
                <div className="space-y-2">
                  {finished.map((exec) => (
                    <ExecutionReportCard
                      key={exec.id}
                      execution={exec}
                      curatorContactId={curatorContactId}
                      curatorConversationId={curatorConversationId}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

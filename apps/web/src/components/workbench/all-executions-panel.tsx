import * as React from "react"
import { IconRefresh } from "@tabler/icons-react"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import type { AIEmployee } from "@/lib/mock-data/ai-employees"
import { EmployeeContactAvatar } from "@/components/chat/contact-avatars"
import { ExecutionCard } from "@/components/chat/execution-card"

function formatTimeShort(iso: string | null | undefined): string {
  if (!iso) return ""
  return format(new Date(iso), "HH:mm", { locale: zhCN })
}

interface AllExecutionsPanelProps {
  className?: string
}

export function AllExecutionsPanel({ className }: AllExecutionsPanelProps) {
  const {
    data: executions = [],
    isLoading,
    isFetching,
    refetch,
    dataUpdatedAt,
  } = useAllTaskExecutions()

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

  const sorted = React.useMemo(() => {
    return [...executions].sort((a, b) => {
      const ta = new Date(a.started_at).getTime()
      const tb = new Date(b.started_at).getTime()
      return tb - ta
    })
  }, [executions])

  const updatedAtLabel = dataUpdatedAt
    ? format(new Date(dataUpdatedAt), "HH:mm:ss", { locale: zhCN })
    : ""

  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l bg-muted/20",
        className
      )}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex flex-col">
          <span className="text-xs font-medium">实时执行记录</span>
          {updatedAtLabel && (
            <span className="text-[10px] text-muted-foreground">
              更新于 {updatedAtLabel}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => refetch()}
          disabled={isFetching}
          title="刷新"
        >
          <IconRefresh
            className={cn("size-4", isFetching && "animate-spin")}
          />
        </Button>
      </div>

      <ScrollArea type="auto" className="h-0 min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {isLoading ? (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          ) : sorted.length === 0 ? (
            <div className="px-2 py-8 text-center text-xs text-muted-foreground">
              暂无执行记录
            </div>
          ) : (
            sorted.map((execution) => {
              const employee = employeeMap.get(String(execution.employee_id))
              return (
                <div key={execution.id}>
                  <div className="mb-1.5 flex items-center gap-2">
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
                    <span className="ml-auto text-[10px] text-muted-foreground/70">
                      {formatTimeShort(execution.started_at)}
                    </span>
                  </div>
                  <ExecutionCard execution={execution} />
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

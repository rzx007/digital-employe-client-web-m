import { cn } from "@workspace/ui/lib/utils"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { getStatusLabel } from "./hooks/use-shift-calendar"

interface ShiftDayCellProps {
  day: number
  inShift: boolean
  status: number
  notes?: string
  isExpired: boolean
  taskCount: number
  taskTypeCount: {
    mcp: number
    skill: number
  }
  isToday: boolean
  isWeekend: boolean
}

const STATUS_COLORS: Record<number, string> = {
  1: "bg-primary/15",
  2: "bg-amber-500/15",
  3: "bg-red-500/10 opacity-50",
}

export function ShiftDayCell({
  inShift,
  status,
  notes,
  isExpired,
  taskCount,
  taskTypeCount,
  isToday,
  isWeekend,
}: ShiftDayCellProps) {
  const shiftBg = inShift ? (STATUS_COLORS[status] ?? STATUS_COLORS[1]) : ""
  const weekendBg = !inShift && isWeekend ? "bg-muted/30" : ""
  const expiredBg = isExpired ? "bg-muted/50" : ""
  const bgClass = expiredBg || shiftBg || weekendBg
  const hasTask = taskCount > 0

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <div
          className={cn(
            "flex h-11 items-center justify-center border-b border-r border-border/40 transition-colors",
            bgClass,
            isToday && "ring-1 ring-inset ring-primary/40",
          )}
        >
          {inShift && (
            <div
              className={cn(
                "size-4 rounded-sm",
                isExpired && "bg-muted-foreground/35",
                !isExpired && status === 1 && "bg-primary/50",
                !isExpired && status === 0 && "bg-amber-500/50",
              )}
            />
          )}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="center" className="text-xs">
        {inShift ? (
          <div className="flex flex-col gap-0.5">
            <span>状态：{getStatusLabel(status)}</span>
            {isExpired && <span className="text-muted-foreground">已过期</span>}
            <span>任务：{taskCount}</span>
            {hasTask && (
              <span className="text-muted-foreground">
                类型：MCP {taskTypeCount.mcp} / Skill {taskTypeCount.skill}
              </span>
            )}
            {notes && <span className="text-muted-foreground">{notes}</span>}
          </div>
        ) : (
          <span className="text-muted-foreground">无排班</span>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

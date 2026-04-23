import { useMemo, Fragment } from "react"
import { getDay } from "date-fns"
import { cn } from "@workspace/ui/lib/utils"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { createDiceBearAvatar } from "@/lib/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import type { Employee } from "@/api/types"
import type { ShiftCellData } from "./hooks/use-shift-calendar"
import { getEmployeeDisplayName } from "./hooks/use-shift-calendar"
import { ShiftDayCell } from "./shift-day-cell"

interface ShiftCalendarGridProps {
  employees: Employee[]
  groupedEmployees: {
    active: Employee[]
    inactive: Employee[]
    unscheduled: Employee[]
  }
  shiftMap: Map<number, Map<number, ShiftCellData>>
  year: number
  month: number
  daysInMonth: number
  searchQuery: string
  selectedEmployeeId: number | null
  onEmployeeClick: (employee: Employee) => void
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"]

interface GroupDef {
  key: string
  label: string
  employees: Employee[]
}

export function ShiftCalendarGrid({
  groupedEmployees,
  shiftMap,
  year,
  month,
  daysInMonth,
  searchQuery,
  selectedEmployeeId,
  onEmployeeClick,
}: ShiftCalendarGridProps) {
  const today = useMemo(() => {
    const now = new Date()
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
    }
  }, [])

  const days = useMemo(() => {
    return Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1
      const date = new Date(year, month - 1, day)
      const weekday = getDay(date)
      const weekdayIdx = (weekday + 6) % 7
      return {
        day,
        weekday: WEEKDAY_LABELS[weekdayIdx],
        isWeekend: weekday === 0 || weekday === 6,
        isToday: year === today.year && month === today.month && day === today.day,
      }
    })
  }, [year, month, daysInMonth, today])

  const groups = useMemo((): GroupDef[] => {
    const q = searchQuery.trim().toLowerCase()
    const filter = (list: Employee[]) =>
      q
        ? list.filter((emp) =>
          getEmployeeDisplayName(emp).toLowerCase().includes(q),
        )
        : list

    return [
      { key: "active", label: "激活中", employees: filter(groupedEmployees.active) },
      {
        key: "inactive",
        label: "未激活",
        employees: filter(groupedEmployees.inactive),
      },
      {
        key: "unscheduled",
        label: "无排班",
        employees: filter(groupedEmployees.unscheduled),
      },
    ].filter((g) => g.employees.length > 0)
  }, [groupedEmployees, searchQuery])

  const colTemplate = `200px repeat(${daysInMonth}, minmax(40px, 1fr))`

  const renderGroupHeader = (group: GroupDef) => (
    <div
      key={`group-${group.key}`}
      className="flex items-center gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground"
      style={{ gridColumn: "1 / -1" }}
    >
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "size-1.5 rounded-full",
            group.key === "active" && "bg-primary",
            group.key === "inactive" && "bg-amber-500",
            group.key === "unscheduled" && "bg-muted-foreground/40",
          )}
        />
        {group.label}（{group.employees.length}）
      </span>
    </div>
  )

  const renderEmployeeRow = (employee: Employee) => {
    const empShiftMap = shiftMap.get(employee.id)
    const name = getEmployeeDisplayName(employee)
    const isSelected = selectedEmployeeId === employee.id

    return (
      <Fragment key={employee.id}>
        <div
          className={cn(
            "sticky left-0 z-10 flex cursor-pointer items-center gap-2 border-b border-r bg-background px-3 transition-colors hover:bg-muted/50",
            isSelected && "bg-primary/5",
          )}
          onClick={() => onEmployeeClick(employee)}
        >
          <Avatar size="sm">
            <AvatarImage src={createDiceBearAvatar(String(employee.id))} />
            <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
              {name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate text-xs font-medium">{name}</span>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              {name}
              {employee.description && (
                <span className="ml-1 text-muted-foreground">
                  · {employee.description}
                </span>
              )}
            </TooltipContent>
          </Tooltip>
        </div>
        {days.map(({ day, isWeekend, isToday: isTodayCell }) => {
          const cellData = empShiftMap?.get(day)
          return (
            <ShiftDayCell
              key={day}
              day={day}
              inShift={cellData?.inShift ?? false}
              status={cellData?.status ?? 0}
              notes={cellData?.notes}
              isExpired={cellData?.isExpired ?? false}
              taskCount={cellData?.taskCount ?? 0}
              taskTypeCount={cellData?.taskTypeCount ?? { mcp: 0, skill: 0 }}
              isToday={isTodayCell}
              isWeekend={isWeekend}
            />
          )
        })}
      </Fragment>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex-1 overflow-auto">
        <div className="grid min-w-max" style={{ gridTemplateColumns: colTemplate }}>
          {/* Header: corner cell */}
          <div className="sticky left-0 top-0 z-30 flex items-center justify-center border-b border-r bg-background px-2 py-2 text-xs font-medium text-muted-foreground">
            员工
          </div>

          {/* Header: day columns */}
          {days.map(({ day, weekday, isWeekend, isToday: isTodayCell }) => (
            <div
              key={`header-${day}`}
              className={cn(
                "sticky top-0 z-20 flex flex-col items-center border-b bg-background py-1.5",
                isWeekend && "bg-muted/20",
                isTodayCell && "bg-primary/5",
              )}
            >
              <span className="text-[10px] text-muted-foreground">{weekday}</span>
              <span
                className={cn(
                  "mt-0.5 flex size-5 items-center justify-center rounded-full text-xs font-medium",
                  isTodayCell && "bg-primary text-primary-foreground",
                )}
              >
                {day}
              </span>
            </div>
          ))}

          {/* Body: groups with employee rows */}
          {groups.map((group) => (
            <Fragment key={group.key}>
              {renderGroupHeader(group)}
              {group.employees.map(renderEmployeeRow)}
            </Fragment>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

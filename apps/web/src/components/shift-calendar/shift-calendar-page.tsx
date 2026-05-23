import * as React from "react"
import { cn } from "@workspace/ui/lib/utils"
import { useShiftCalendar } from "./hooks/use-shift-calendar"
import { ShiftCalendarToolbar } from "./shift-calendar-toolbar"
import { ShiftCalendarGrid } from "./shift-calendar-grid"
import { ShiftEditSheet } from "./shift-edit-sheet"

export function ShiftCalendarPage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const now = new Date()
  const [year, setYear] = React.useState(now.getFullYear())
  const [month, setMonth] = React.useState(now.getMonth() + 1)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [selectedEmployeeId, setSelectedEmployeeId] = React.useState<
    number | null
  >(null)

  const { employees, shiftMap, groupedEmployees, daysInMonth, isLoading } =
    useShiftCalendar(year, month)

  const handleMonthChange = (y: number, m: number) => {
    setYear(y)
    setMonth(m)
  }

  const activeCount =
    groupedEmployees.active.length + groupedEmployees.inactive.length

  return (
    <div
      className={cn("flex h-full flex-col bg-background", className)}
      {...props}
    >
      <ShiftCalendarToolbar
        year={year}
        month={month}
        onMonthChange={handleMonthChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalEmployees={employees.length}
        activeCount={activeCount}
      />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          加载中...
        </div>
      ) : employees.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <p className="text-sm">暂无员工</p>
          <p className="text-xs">请先添加员工后再查看排班日历</p>
        </div>
      ) : (
        <>
          <ShiftCalendarGrid
            employees={employees}
            groupedEmployees={groupedEmployees}
            shiftMap={shiftMap}
            year={year}
            month={month}
            daysInMonth={daysInMonth}
            searchQuery={searchQuery}
            selectedEmployeeId={selectedEmployeeId}
            onEmployeeClick={(emp) => setSelectedEmployeeId(emp.id)}
          />

          <div className="flex items-center gap-5 border-t px-4 py-2">
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary/15" />
              <span className="text-[10px] text-muted-foreground">激活中</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-amber-500/15" />
              <span className="text-[10px] text-muted-foreground">未激活</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-muted/50" />
              <span className="text-[10px] text-muted-foreground">已过期</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm border border-border" />
              <span className="text-[10px] text-muted-foreground">无排班</span>
            </div>
            <span className="ml-auto text-[10px] text-muted-foreground">
              点击员工名称编辑排班
            </span>
          </div>
        </>
      )}

      <ShiftEditSheet
        employeeId={selectedEmployeeId}
        open={selectedEmployeeId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEmployeeId(null)
        }}
      />
    </div>
  )
}

import { useMemo } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { parseISO } from "date-fns"
import { chatKeys } from "@/lib/query-keys/chat"
import { fetchEmployees, updateEmployee } from "@/api/employee"
import type { Employee, MetadataTask } from "@/api/types"
import type { ShiftScheduleForm } from "@/types/task"

interface ShiftTaskTypeCount {
  mcp: number
  skill: number
}

export interface ShiftCellData {
  status: number
  notes?: string
  inShift: boolean
  isExpired: boolean
  taskCount: number
  taskTypeCount: ShiftTaskTypeCount
}

function hasTasksSchedule(employee: Employee): boolean {
  return (
    Array.isArray(employee.metadata?.tasks) && employee.metadata.tasks.length > 0
  )
}

function isTaskActive(task: MetadataTask): boolean {
  return task.is_active !== false
}

function isTaskMatchedOnDate(task: MetadataTask, date: Date): boolean {
  const cronType = task.cron_expression_type ?? "daily"
  const weekday = date.getDay()

  switch (cronType) {
    case "weekdays":
      return weekday >= 1 && weekday <= 5
    case "weekends":
      return weekday === 0 || weekday === 6
    case "loop":
    case "daily":
    default:
      return true
  }
}

function getTaskType(task: MetadataTask): keyof ShiftTaskTypeCount | null {
  const taskType = String(
    task.dispatch_type ?? task.task_resource_type ?? "",
  ).toLowerCase()

  if (taskType === "mcp") return "mcp"
  if (taskType === "skill") return "skill"
  return null
}

function getTaskStatsForDate(
  tasks: MetadataTask[],
  date: Date,
): {
  taskCount: number
  taskTypeCount: ShiftTaskTypeCount
} {
  const taskTypeCount: ShiftTaskTypeCount = { mcp: 0, skill: 0 }
  let taskCount = 0

  for (const task of tasks) {
    if (!isTaskActive(task) || !isTaskMatchedOnDate(task, date)) {
      continue
    }

    taskCount += 1
    const taskType = getTaskType(task)
    if (taskType) {
      taskTypeCount[taskType] += 1
    }
  }

  return { taskCount, taskTypeCount }
}

export function useShiftCalendar(year: number, month: number) {
  const queryClient = useQueryClient()

  const { data: employees = [], isLoading } = useQuery({
    queryKey: chatKeys.shiftCalendar(year, month),
    queryFn: async () => {
      const res = await fetchEmployees()
      return (res?.data ?? []) as Employee[]
    },
    staleTime: 30_000,
  })

  const daysInMonth = useMemo(
    () => new Date(year, month, 0).getDate(),
    [year, month],
  )

  const shiftMap = useMemo(() => {
    const map = new Map<number, Map<number, ShiftCellData>>()
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)

    for (const emp of employees) {
      const empMap = new Map<number, ShiftCellData>()
      const schedule = emp.shift_schedule
      const hasSchedule = hasTasksSchedule(emp)
      const tasks = emp.metadata?.tasks ?? []

      if (hasSchedule) {
        const startDate = schedule.start_date
          ? parseISO(schedule.start_date)
          : null
        const endDate = schedule.end_date ? parseISO(schedule.end_date) : null

        for (let day = 1; day <= daysInMonth; day++) {
          const current = new Date(year, month - 1, day)
          const isExpired = current < todayStart
          const inShift =
            (!startDate || current >= startDate) &&
            (!endDate || current <= endDate)
          const taskStats = inShift
            ? getTaskStatsForDate(tasks, current)
            : { taskCount: 0, taskTypeCount: { mcp: 0, skill: 0 } }

          empMap.set(day, {
            status: schedule.status ?? 1,
            notes: schedule.notes,
            inShift,
            isExpired,
            taskCount: taskStats.taskCount,
            taskTypeCount: taskStats.taskTypeCount,
          })
        }
      }

      map.set(emp.id, empMap)
    }

    return map
  }, [employees, year, month, daysInMonth])

  const groupedEmployees = useMemo(() => {
    const active: Employee[] = []
    const inactive: Employee[] = []
    const unscheduled: Employee[] = []

    for (const emp of employees) {
      const schedule = emp.shift_schedule
      const hasSchedule = hasTasksSchedule(emp)

      if (!hasSchedule) {
        unscheduled.push(emp)
      } else if (schedule.status === 0) {
        inactive.push(emp)
      } else {
        active.push(emp)
      }
    }

    return { active, inactive, unscheduled }
  }, [employees])

  const updateMutation = useMutation({
    mutationFn: async ({
      employeeId,
      employeeName,
      shiftSchedule,
    }: {
      employeeId: number
      employeeName: string
      shiftSchedule: ShiftScheduleForm
    }) => {
      return updateEmployee(employeeId, {
        employee_name: employeeName,
        shift_schedule: shiftSchedule,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "shift-calendar"],
      })
      queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
    },
  })

  return {
    employees,
    shiftMap,
    groupedEmployees,
    daysInMonth,
    isLoading,
    updateShiftSchedule: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  }
}

export function getEmployeeDisplayName(emp: Employee): string {
  return (
    emp.name ||
    emp.metadata?.employee_name ||
    emp.employee_code ||
    "未知员工"
  )
}

export function getStatusLabel(status: number): string {
  switch (status) {
    case 1:
      return "激活中"
    case 0:
      return "未激活"
    default:
      return "未知"
  }
}

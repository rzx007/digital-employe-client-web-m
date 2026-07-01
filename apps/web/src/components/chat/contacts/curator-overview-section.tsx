import * as React from "react"
import {
  IconCheck,
  IconClock,
  IconListDetails,
  IconX,
  IconUser,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useAllTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { EmployeeContactAvatar } from "./contact-avatars"

function StatCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  valueColor,
}: {
  label: string
  value: number
  icon: typeof IconListDetails
  iconBg: string
  iconColor: string
  valueColor: string
}) {
  return (
    <div className="group relative flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          iconBg
        )}
      >
        <Icon className={cn("size-4", iconColor)} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span
          className={cn(
            "text-base leading-tight font-bold tabular-nums",
            valueColor
          )}
        >
          {value}
        </span>
        <span className="text-[10px] leading-tight text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  )
}

interface EmployeeStat {
  id: string
  name: string
  avatar?: string
  status?: "online" | "busy" | "offline"
  total: number
  success: number
  failed: number
}

function EmployeeRow({
  stat,
  onClick,
}: {
  stat: EmployeeStat
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <EmployeeContactAvatar
        name={stat.name}
        avatar={stat.avatar}
        status={stat.status}
        showStatus
        avatarClassName="size-7"
        fallbackClassName="text-[10px]"
      />
      <span className="flex-1 truncate text-xs font-medium">{stat.name}</span>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="tabular-nums">{stat.total} 次</span>
        <span className="text-green-600 tabular-nums dark:text-green-400">
          {stat.success}
        </span>
        <span className="text-red-600 tabular-nums dark:text-red-400">
          {stat.failed}
        </span>
      </div>
    </button>
  )
}

export function CuratorOverviewSection() {
  const { data: executions = [], isPending } = useAllTaskExecutions()
  const contacts = useChatStore((s) => s.contacts)
  const openMonitor = useMonitorStore((s) => s.openMonitor)

  const { total, success, failed, pending, employeeStats } =
    React.useMemo(() => {
      const employeeMap = new Map<string, EmployeeStat>()

      for (const c of contacts) {
        if (c.type === "employee" && c.employee) {
          employeeMap.set(c.employee.id, {
            id: c.employee.id,
            name: c.employee.name,
            avatar: c.employee.avatar,
            status: c.employee.status,
            total: 0,
            success: 0,
            failed: 0,
          })
        }
      }

      const totalCount = executions.length
      let successCount = 0
      let failedCount = 0
      let pendingCount = 0

      for (const exec of executions) {
        const empId = String(exec.employee_id)
        const stat = employeeMap.get(empId)
        if (stat) {
          stat.total++
          if (exec.run_status === "success") {
            stat.success++
            successCount++
          } else if (
            exec.run_status === "failed" ||
            exec.run_status === "timeout"
          ) {
            stat.failed++
            failedCount++
          } else {
            pendingCount++
          }
        }
      }

      return {
        total: totalCount,
        success: successCount,
        failed: failedCount,
        pending: pendingCount,
        employeeStats: [...employeeMap.values()],
      }
    }, [executions, contacts])

  if (isPending) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <span className="text-xs">加载中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <StatCard
          label="总执行次数"
          value={total}
          icon={IconListDetails}
          iconBg="bg-muted"
          iconColor="text-foreground"
          valueColor="text-foreground"
        />
        <StatCard
          label="员工数量"
          value={employeeStats.length}
          icon={IconUser}
          iconBg="bg-blue-100 dark:bg-blue-900/40"
          iconColor="text-blue-600 dark:text-blue-400"
          valueColor="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          label="成功"
          value={success}
          icon={IconCheck}
          iconBg="bg-green-100 dark:bg-green-900/40"
          iconColor="text-green-600 dark:text-green-400"
          valueColor="text-green-600 dark:text-green-400"
        />
        <StatCard
          label="失败"
          value={failed}
          icon={IconX}
          iconBg="bg-red-100 dark:bg-red-900/40"
          iconColor="text-red-600 dark:text-red-400"
          valueColor="text-red-600 dark:text-red-400"
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          员工执行概况
        </p>
        {employeeStats.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            暂无员工数据
          </p>
        ) : (
          employeeStats.map((stat) => (
            <EmployeeRow
              key={stat.id}
              stat={stat}
              onClick={() => openMonitor(stat.id, stat.name)}
            />
          ))
        )}
      </div>
    </div>
  )
}

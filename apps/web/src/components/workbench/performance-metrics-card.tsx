import { cn } from "@workspace/ui/lib/utils"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useAuthStore } from "@/stores/auth-store"
import { useCurrentMonthPerformance } from "@/hooks/use-performance-queries"
import Avatar1 from "@/assets/avaters/1.png"
import Avatar2 from "@/assets/avaters/2.png"
import Avatar3 from "@/assets/avaters/3.png"
import Avatar4 from "@/assets/avaters/4.png"
import Avatar5 from "@/assets/avaters/5.png"
import Avatar6 from "@/assets/avaters/6.png"
import Avatar7 from "@/assets/avaters/7.png"
import Avatar8 from "@/assets/avaters/8.png"
import Avatar9 from "@/assets/avaters/9.png"

const avatars = [
  Avatar1,
  Avatar2,
  Avatar3,
  Avatar4,
  Avatar5,
  Avatar6,
  Avatar7,
  Avatar8,
  Avatar9,
  Avatar1,
]

function getUserAvatarSrc(userId?: string | number | null) {
  if (!userId) return Avatar1
  return avatars[parseInt(userId.toString()) % 10]
}

type DeviationLevel = "normal" | "warning" | "danger"

function getDeviationLevel(value: number): DeviationLevel {
  const abs = Math.abs(value)
  if (abs <= 0.1) return "normal"
  if (abs <= 0.3) return "warning"
  return "danger"
}

const DEVIATION_COLORS: Record<
  DeviationLevel,
  { bar: string; text: string }
> = {
  normal: {
    bar: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    bar: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
  },
}

function CompactDeviationIndicator({ value }: { value: number }) {
  const level = getDeviationLevel(value)
  const colors = DEVIATION_COLORS[level]
  const percent = Math.min(Math.abs(value) * 100, 100)

  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1 w-12 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", colors.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        className={cn(
          "text-[10px] font-medium tabular-nums",
          colors.text
        )}
      >
        {value.toFixed(2)}
      </span>
    </div>
  )
}

function DeviationBar({ value }: { value: number }) {
  const level = getDeviationLevel(value)
  const colors = DEVIATION_COLORS[level]
  const percent = Math.min(Math.abs(value) * 100, 100)

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", colors.bar)}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span
        className={cn(
          "text-[10px] font-medium tabular-nums",
          colors.text
        )}
      >
        {value.toFixed(2)}
      </span>
    </div>
  )
}

function MetricCard({
  label,
  value,
  className,
}: {
  label: string
  value: number | string
  className?: string
}) {
  return (
    <div className={cn("flex flex-col justify-between px-4 py-3", className)}>
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {typeof value === "number" ? value.toFixed(2) : value}
      </span>
    </div>
  )
}

function parsePeriod(period: string) {
  const parts = period.split("-")
  return { year: parts[0] ?? "", month: parts[1] ?? "" }
}

function CompactPerformanceCard() {
  const { data, isLoading, isError } = useCurrentMonthPerformance()
  const user = useAuthStore((s) => s.user)
  const avatarSrc = getUserAvatarSrc(user?.id)

  if (isError) return null

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border">
        <div className="h-[3px] bg-gradient-to-r from-slate-700 via-slate-500 to-slate-400 dark:from-slate-600 dark:via-slate-400 dark:to-slate-300" />
        <div className="space-y-2 p-3">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-2.5 w-28" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* Gradient accent strip */}
      <div className="h-[3px] bg-gradient-to-r from-slate-700 via-slate-500 to-slate-400 dark:from-slate-600 dark:via-slate-400 dark:to-slate-300" />

      <div className="p-3">
        {/* Profile header */}
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={avatarSrc} alt={data.username} />
            <AvatarFallback className="bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {data.username.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{data.username}</span>
              <span className="text-[10px] text-muted-foreground">
                No.{data.work_no}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {data.assessment_period}
              {data.assessment_department && (
                <>
                  <span className="mx-1 opacity-40">·</span>
                  {data.assessment_department}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Centered label divider */}
        <div className="my-2.5 flex items-center gap-2">
          <div className="h-px flex-1 bg-border/40" />
          <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
            考核指标
          </span>
          <div className="h-px flex-1 bg-border/40" />
        </div>

        {/* Numeric metrics */}
        <div className="space-y-0.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span title="当月AC总值" className="text-muted-foreground">
              AC总值
            </span>
            <span className="font-semibold tabular-nums">
              {data.monthly_ac_total.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span title="当月EV总值" className="text-muted-foreground">
              EV总值
            </span>
            <span className="font-semibold tabular-nums">
              {data.monthly_ev_total.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span title="AC实发基准" className="text-muted-foreground">
              AC实发
            </span>
            <span className="font-semibold tabular-nums">
              {data.ac_actual_base_value.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Deviation metrics */}
        <div className="mt-1.5 space-y-0.5 rounded-md bg-muted/40 px-2 py-1.5 text-[11px]">
          <div className="flex items-center justify-between">
            <span title="当月工作偏差" className="text-muted-foreground">
              工作偏差
            </span>
            <CompactDeviationIndicator value={data.monthly_work_deviation} />
          </div>
          <div className="flex items-center justify-between">
            <span title="工作日基准偏差" className="text-muted-foreground">
              基准偏差
            </span>
            <CompactDeviationIndicator value={data.workday_base_deviation} />
          </div>
        </div>
      </div>
    </div>
  )
}

function FullPerformanceCard() {
  const { data, isLoading, isError } = useCurrentMonthPerformance()

  if (isError) return null

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border border-border/50">
        <div className="bg-slate-900 px-5 py-4 dark:bg-slate-800">
          <Skeleton className="h-5 w-16 bg-white/20" />
          <Skeleton className="mt-2 h-8 w-24 bg-white/20" />
        </div>
        <div className="grid grid-cols-3 gap-px bg-border/30 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-sm" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { year, month } = parsePeriod(data.assessment_period)

  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <div className="relative bg-slate-900 px-5 py-4 dark:bg-slate-800">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight text-white">
                {year}
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-light text-white/50">——</span>
              <span className="text-xl font-semibold text-white">
                {month}
              </span>
            </div>
            <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              考核周期
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm font-medium text-white/90">
              {data.username}
            </div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-white/40">
              No. {data.work_no}
            </div>
            {data.assessment_department && (
              <div className="mt-1.5 inline-block border border-white/20 px-2 py-0.5 text-[10px] tracking-wider text-white/50">
                {data.assessment_department}
              </div>
            )}
          </div>
        </div>

        <div className="absolute bottom-0 left-5 right-5 h-px bg-white/10" />
      </div>

      <div className="p-3">
        <div className="grid grid-cols-3">
          <MetricCard label="当月AC总值" value={data.monthly_ac_total} />
          <MetricCard
            label="当月EV总值"
            value={data.monthly_ev_total}
            className="border-x border-border/30"
          />
          <MetricCard
            label="AC实发基准"
            value={data.ac_actual_base_value}
          />
        </div>

        <div className="my-3 h-px bg-border/30" />

        <div className="grid grid-cols-2 gap-3">
          <div className="border border-border/50 px-4 py-3">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              当月工作偏差
            </span>
            <div className="mt-2.5">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {data.monthly_work_deviation.toFixed(2)}
              </span>
            </div>
            <div className="mt-2">
              <DeviationBar value={data.monthly_work_deviation} />
            </div>
          </div>
          <div className="border border-border/50 px-4 py-3">
            <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              工作日基准偏差
            </span>
            <div className="mt-2.5">
              <span className="text-2xl font-semibold tabular-nums tracking-tight">
                {data.workday_base_deviation.toFixed(2)}
              </span>
            </div>
            <div className="mt-2">
              <DeviationBar value={data.workday_base_deviation} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PerformanceMetricsCard({ compact }: { compact?: boolean }) {
  if (compact) return <CompactPerformanceCard />
  return <FullPerformanceCard />
}

import { cn } from "@workspace/ui/lib/utils"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useCurrentMonthPerformance } from "@/hooks/use-performance-queries"

type DeviationLevel = "normal" | "warning" | "danger"

function getDeviationLevel(value: number): DeviationLevel {
  const abs = Math.abs(value)
  if (abs <= 0.1) return "normal"
  if (abs <= 0.3) return "warning"
  return "danger"
}

const DEVIATION_COLORS: Record<
  DeviationLevel,
  { bar: string; bg: string; text: string }
> = {
  normal: {
    bar: "bg-emerald-500",
    bg: "bg-emerald-500/10",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  warning: {
    bar: "bg-amber-500",
    bg: "bg-amber-500/10",
    text: "text-amber-600 dark:text-amber-400",
  },
  danger: {
    bar: "bg-red-500",
    bg: "bg-red-500/10",
    text: "text-red-600 dark:text-red-400",
  },
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
      <span className={cn("text-[10px] font-medium tabular-nums", colors.text)}>
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
    <div
      className={cn(
        "flex flex-col justify-between px-4 py-3",
        className
      )}
    >
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

export function PerformanceMetricsCard() {
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
      {/* Swiss-style dark header */}
      <div className="relative bg-slate-900 px-5 py-4 dark:bg-slate-800">
        <div className="flex items-start justify-between">
          {/* Left: period typography */}
          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold tracking-tight text-white">
                {year}
              </span>
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-light text-white/50">——</span>
              <span className="text-xl font-semibold text-white">{month}</span>
            </div>
            <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              考核周期
            </div>
          </div>

          {/* Right: user info */}
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

        {/* Decorative thin line */}
        <div className="absolute bottom-0 left-5 right-5 h-px bg-white/10" />
      </div>

      {/* Metrics grid */}
      <div className="p-3">
        {/* Top row: 3 numeric metrics with dividers */}
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

        {/* Thin divider */}
        <div className="my-3 h-px bg-border/30" />

        {/* Bottom row: 2 deviation metrics */}
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

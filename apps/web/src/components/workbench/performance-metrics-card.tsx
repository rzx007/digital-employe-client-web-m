import { IconHelpCircle } from "@tabler/icons-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useCurrentMonthPerformance } from "@/hooks/use-performance-queries"

function formatMoney(value: number): string {
  return `¥ ${new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)}`
}

function formatRank(rank: number): string {
  return rank === -1 ? "--" : `#${rank}`
}

function getBalanceProgress(balance: number): number {
  return Math.min(100, Math.max(0, balance * 100))
}

function formatMonthPeriod(monthRaw: string): string {
  const [y, m] = monthRaw.split("-")
  if (!y || m === undefined || m === "") return monthRaw
  const monthNum = parseInt(m, 10)
  if (Number.isNaN(monthNum)) return monthRaw
  return `${y}年${monthNum}月`
}

function PerformanceLabelWithHelp({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      绩效
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="绩效说明"
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            <IconHelpCircle className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-56 text-[11px]">
          <p>绩效 = 当月绩效系数（0~1），数值越高表示当月绩效越好。</p>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

function MetricCard({
  label,
  value,
  hint,
  className,
}: {
  label: React.ReactNode
  value: string
  hint?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-1 px-3 py-3 sm:px-4",
        className
      )}
    >
      <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </span>
      {hint ? (
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
}

function CompactPerformanceCard() {
  const { data, isLoading, isError } = useCurrentMonthPerformance()

  if (isError) return null

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-lg border">
        <div className="h-0.5 bg-primary/80" />
        <div className="space-y-2 p-3">
          <div className="space-y-1">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-2.5 w-28" />
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
      <div className="h-0.5 bg-primary/80" />
      <div className="p-3">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold">{data.name}</span>
            <span className="text-[10px] text-muted-foreground">
              工号 {data.staff_no || "--"}
            </span>
          </div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {formatMonthPeriod(data.month)}
          </div>
        </div>

        <div className="mt-3 border-t border-border/40 pt-2.5">
          <p className="mb-2 text-[10px] font-medium text-muted-foreground">
            月度绩效
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <PerformanceLabelWithHelp className="text-[11px] text-muted-foreground" />
              <span className="text-sm font-semibold tabular-nums">
                {data.gdp.toFixed(2)}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${getBalanceProgress(data.gdp)}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border/50 p-2">
              <div className="flex flex-col">
                <span className="text-[10px] text-muted-foreground">
                  当月金额
                </span>
                <span className="text-[11px] font-semibold tabular-nums">
                  {formatMoney(data.balance)}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-muted-foreground">排名</span>
                <span className="text-[11px] font-semibold tabular-nums">
                  {formatRank(data.rank)}
                </span>
                {data.rank === -1 ? (
                  <span className="text-[9px] text-muted-foreground">
                    暂无排名
                  </span>
                ) : null}
              </div>
            </div>
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
        <div className="h-0.5 bg-primary/80" />
        <div className="border-b border-border/50 bg-muted/40 px-5 py-4">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="mt-2 h-3 w-40" />
          <Skeleton className="mt-3 h-3 w-24" />
        </div>
        <div className="grid grid-cols-3 gap-3 p-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <div className="h-0.5 bg-primary/80" />
      <div className="border-b border-border/50 bg-muted/40 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              {formatMonthPeriod(data.month)}
            </p>
            <p className="mt-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              绩效周期
            </p>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-sm font-medium text-foreground">
              {data.name}
            </div>
            <div className="mt-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              工号 {data.staff_no || "--"}
            </div>
          </div>
        </div>
      </div>

      <div className="p-3">
        <div className="grid grid-cols-3 gap-3">
          <MetricCard
            label={
              <PerformanceLabelWithHelp className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase" />
            }
            value={data.gdp.toFixed(2)}
          />
          <MetricCard label="当月金额" value={formatMoney(data.balance)} />
          <MetricCard
            label="排名"
            value={formatRank(data.rank)}
            hint={data.rank === -1 ? "暂无排名" : undefined}
          />
        </div>

        <div className="my-3 h-px bg-border/30" />

        <div className="space-y-2 rounded-md border border-border/50 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">绩效进度</span>
            <span className="font-semibold tabular-nums">
              {Math.round(getBalanceProgress(data.gdp))}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${getBalanceProgress(data.gdp)}%` }}
            />
          </div>
          {data.rank !== -1 ? (
            <p className="text-[10px] text-muted-foreground">
              排名根据当月累计绩效统计
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function PerformanceMetricsCard({ compact }: { compact?: boolean }) {
  if (compact) return <CompactPerformanceCard />
  return <FullPerformanceCard />
}

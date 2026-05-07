import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { IconHelpCircle } from "@tabler/icons-react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { useCurrentMonthPerformance } from "@/hooks/use-performance-queries"
import { useAuthStore } from "@/stores/auth-store"
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
  return avatars[parseInt(userId.toString(), 10) % 10]
}

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

function PerformanceLabelWithHelp({
  className,
}: {
  className?: string
}) {
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
    <div className={cn("flex flex-col justify-between px-4 py-3", className)}>
      <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </span>
      {hint ? (
        <span className="mt-1 text-[10px] text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  )
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
      <div className="h-[3px] bg-gradient-to-r from-slate-700 via-slate-500 to-slate-400 dark:from-slate-600 dark:via-slate-400 dark:to-slate-300" />
      <div className="p-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarImage src={avatarSrc} alt={data.name} />
            <AvatarFallback className="bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {data.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold">{data.name}</span>
              <span className="text-[10px] text-muted-foreground">
                工号 {data.staff_no || "--"}
              </span>
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {data.month}
            </div>
          </div>
        </div>

        <div className="my-2.5 flex items-center gap-2">
          <div className="h-px flex-1 bg-border/40" />
          <span className="text-[9px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
            月度绩效
          </span>
          <div className="h-px flex-1 bg-border/40" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <PerformanceLabelWithHelp className="text-[11px] text-muted-foreground" />
            <span className="text-sm font-semibold tabular-nums">
              {data.gdp.toFixed(2)}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${getBalanceProgress(data.gdp)}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 px-2 py-1.5">
            <div className="flex flex-col">
              <span className="text-[10px] text-muted-foreground">当月金额</span>
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
                <span className="text-[9px] text-muted-foreground">暂无排名</span>
              ) : null}
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

  const [year = "", monthValue = ""] = data.month.split("-")

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
                {monthValue}
              </span>
            </div>
            <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40">
              绩效周期
            </div>
          </div>

          <div className="text-right">
            <div className="text-sm font-medium text-white/90">{data.name}</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-white/40">
              工号 {data.staff_no || "--"}
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-5 right-5 h-px bg-white/10" />
      </div>

      <div className="p-3">
        <div className="grid grid-cols-3">
          <MetricCard
            label={
              <PerformanceLabelWithHelp className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground" />
            }
            value={data.gdp.toFixed(2)}
          />
          <MetricCard
            label="当月金额"
            value={formatMoney(data.balance)}
            className="border-x border-border/30"
          />
          <MetricCard
            label="排名"
            value={formatRank(data.rank)}
            hint={data.rank === -1 ? "暂无排名" : undefined}
          />
        </div>

        <div className="my-3 h-px bg-border/30" />

        <div className="space-y-2 rounded-md bg-muted/40 px-4 py-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">绩效进度</span>
            <span className="font-semibold tabular-nums">
              {Math.round(getBalanceProgress(data.gdp))}%
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
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

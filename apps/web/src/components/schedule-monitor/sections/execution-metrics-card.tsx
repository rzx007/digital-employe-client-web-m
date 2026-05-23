import { cn } from "@workspace/ui/lib/utils"
import type { ExecutionMetrics7d } from "@/types/schedule-monitor"

function formatRate(rate: number | null): string {
  if (rate == null) return "—"
  return `${rate}%`
}

function rateTone(rate: number | null): string {
  if (rate == null) return "text-muted-foreground"
  if (rate >= 30) return "text-red-600 dark:text-red-400"
  if (rate >= 10) return "text-amber-600 dark:text-amber-400"
  return "text-foreground"
}

export function ExecutionMetricsCard({
  metrics,
  days = 7,
}: {
  metrics: ExecutionMetrics7d | undefined
  days?: number
}) {
  const rate = metrics?.failure_rate ?? null
  const total = metrics?.total_finished ?? 0
  const failures = metrics?.failure_count ?? 0

  return (
    <div className="rounded-lg border p-4">
      <h3 className="text-xs font-medium text-muted-foreground">
        近 {days} 日失败率
      </h3>

      {!metrics ? (
        <p className="mt-3 text-xs text-muted-foreground">加载中…</p>
      ) : (
        <>
          <p
            className={cn(
              "mt-2 text-2xl font-semibold tracking-tight tabular-nums",
              rateTone(rate)
            )}
          >
            {formatRate(rate)}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {total > 0
              ? `失败与超时 ${failures} 次，已结束 ${total} 次`
              : `近 ${days} 日暂无已结束执行`}
          </p>
          {total > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>成功</dt>
                <dd className="text-foreground tabular-nums">
                  {metrics.success}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>失败</dt>
                <dd className="text-foreground tabular-nums">
                  {metrics.failed}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>超时</dt>
                <dd className="text-foreground tabular-nums">
                  {metrics.timeout}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>取消</dt>
                <dd className="text-foreground tabular-nums">
                  {metrics.cancelled}
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
    </div>
  )
}

import type { AnomalyRecord, AnomalyType } from "@/types/schedule-monitor"
import { cn } from "@workspace/ui/lib/utils"

const ANOMALY_CONFIG: Record<
  AnomalyType,
  { label: string; color: string; dotColor: string }
> = {
  timeout: {
    label: "超时",
    color: "text-orange-600 dark:text-orange-400",
    dotColor: "bg-orange-500",
  },
  error: {
    label: "报错",
    color: "text-red-600 dark:text-red-400",
    dotColor: "bg-red-500",
  },
  duplicate: {
    label: "重复",
    color: "text-blue-600 dark:text-blue-400",
    dotColor: "bg-blue-500",
  },
  stuck: {
    label: "卡死",
    color: "text-purple-600 dark:text-purple-400",
    dotColor: "bg-purple-500",
  },
}

function formatAnomalyTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

function AnomalyRow({ record }: { record: AnomalyRecord }) {
  const config = ANOMALY_CONFIG[record.type]

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2",
        record.resolved && "opacity-60"
      )}
    >
      <span
        className={cn("mt-1 size-2 shrink-0 rounded-full", config.dotColor)}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-[10px] font-medium", config.color)}>
            {config.label}
          </span>
          <span className="truncate text-xs font-medium">
            {record.taskName}
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          {record.message}
        </p>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
        {formatAnomalyTime(record.occurredAt)}
      </span>
    </div>
  )
}

export function AnomalyMonitor({ anomalies }: { anomalies: AnomalyRecord[] }) {
  const unresolvedCount = anomalies.filter((a) => !a.resolved).length

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          异常监控
          {unresolvedCount > 0 && (
            <span className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-medium text-white">
              {unresolvedCount}
            </span>
          )}
        </h3>
      </div>

      {anomalies.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          今日暂无异常
        </p>
      ) : (
        <div className="space-y-1">
          {anomalies.map((record) => (
            <AnomalyRow key={record.id} record={record} />
          ))}
        </div>
      )}
    </div>
  )
}

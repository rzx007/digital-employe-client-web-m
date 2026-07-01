import { Progress } from "@workspace/ui/components/progress"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

interface ProgressItem {
  label: string
  value: number | null
  max?: number | null
  color?: string
}

interface ProgressData {
  items?: ProgressItem[]
}

export function ProgressWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: ProgressData
}) {
  const items: ProgressItem[] = data?.items ?? []

  const hasMax = (item: ProgressItem): boolean =>
    item.max != null && item.max > 0

  const toPercent = (item: ProgressItem): number => {
    if (item.value === null || item.value === undefined) return 0
    if (hasMax(item)) {
      return Math.min(100, Math.max(0, (item.value / item.max!) * 100))
    }
    return Math.min(100, Math.max(0, item.value))
  }

  return (
    <WidgetCard title={widget.title} subtitle={widget.subtitle}>
      {items.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div className="flex h-full flex-col justify-center gap-4">
          {items.map((it, i) => {
            const pct = toPercent(it)
            const hasValue = it.value !== null && it.value !== undefined
            const display = hasValue
              ? hasMax(it)
                ? `${it.value} / ${it.max}`
                : `${it.value}%`
              : "—"

            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-foreground/80">
                    {it.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {display}
                  </span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}

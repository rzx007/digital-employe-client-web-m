import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Progress } from "@workspace/ui/components/progress"
import type { WorkbenchWidget } from "@/types/workbench"

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

  const toPercent = (item: ProgressItem): number => {
    if (item.value === null || item.value === undefined) return 0
    if (item.max) {
      return Math.min(100, Math.max(0, (item.value / item.max) * 100))
    }
    return Math.min(100, Math.max(0, item.value))
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {items.length === 0 ? (
          <div className="flex h-16 items-center justify-center text-xs text-muted-foreground">
            暂无数据
          </div>
        ) : (
          items.map((it, i) => {
            const pct = toPercent(it)
            const hasValue = it.value !== null && it.value !== undefined
            const display = hasValue
              ? it.max
                ? `${it.value} / ${it.max}`
                : `${it.value}%`
              : "—"

            return (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{it.label}</span>
                  <span className="tabular-nums">{display}</span>
                </div>
                <Progress value={pct} />
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

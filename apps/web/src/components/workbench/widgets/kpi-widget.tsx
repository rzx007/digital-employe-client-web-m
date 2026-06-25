import { IconArrowUp, IconArrowDown, IconMinus } from "@tabler/icons-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import type { WorkbenchWidget } from "@/types/workbench"

const ARROW = {
  up: IconArrowUp,
  down: IconArrowDown,
  flat: IconMinus,
} as const

interface KpiItem {
  label?: string
  value?: number | string | null
  unit?: string
  delta?: number | string | null
  deltaDir?: string
}

interface KpiData {
  items?: KpiItem[]
}

export function KpiWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: KpiData
}) {
  const items: KpiItem[] = data?.items ?? []

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        {items.map((it, i) => {
          const Arrow =
            it?.deltaDir ? ARROW[it.deltaDir as keyof typeof ARROW] : null
          const hasValue = it?.value !== null && it?.value !== undefined

          return (
            <div key={i} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">{it?.label}</span>
              <span className="text-2xl font-semibold tabular-nums">
                {hasValue ? `${it?.unit ?? ""}${it.value}` : "—"}
              </span>
              {it?.delta != null && (
                <Badge variant="secondary" className="w-fit gap-0.5">
                  {Arrow && <Arrow className="size-3" />}
                  {it.delta}
                </Badge>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

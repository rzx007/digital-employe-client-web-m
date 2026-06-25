import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconMinus,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

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

const DELTA = {
  up: {
    Icon: IconArrowUpRight,
    cls: "text-emerald-600 bg-emerald-500/10 dark:text-emerald-400",
  },
  down: {
    Icon: IconArrowDownRight,
    cls: "text-red-600 bg-red-500/10 dark:text-red-400",
  },
  flat: { Icon: IconMinus, cls: "text-muted-foreground bg-muted" },
} as const

export function KpiWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: KpiData
}) {
  const items: KpiItem[] = data?.items ?? []

  return (
    <WidgetCard title={widget.title} subtitle={widget.subtitle}>
      {items.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div
          className={cn(
            "grid h-full content-center gap-x-4 gap-y-5",
            items.length <= 1 ? "grid-cols-1" : "grid-cols-2"
          )}
        >
          {items.map((it, i) => {
            const dir = (it?.deltaDir as keyof typeof DELTA) || "flat"
            const d = DELTA[dir] ?? DELTA.flat
            const hasValue = it?.value !== null && it?.value !== undefined
            return (
              <div key={i} className="flex flex-col gap-1.5">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  {it?.label}
                </span>
                <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
                  {hasValue ? (
                    <>
                      {it?.unit ? (
                        <span className="mr-0.5 text-lg font-medium text-muted-foreground">
                          {it.unit}
                        </span>
                      ) : null}
                      {it.value}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
                {it?.delta != null ? (
                  <span
                    className={cn(
                      "inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
                      d.cls
                    )}
                  >
                    <d.Icon className="size-3" />
                    {it.delta}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </WidgetCard>
  )
}

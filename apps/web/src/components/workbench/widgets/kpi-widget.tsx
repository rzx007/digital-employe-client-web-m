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

// 货币符号放数值前,其余单位(球/个/% 等)放数值后
const CURRENCY = new Set(["¥", "￥", "$", "€", "£"])
const colorOf = (i: number) => `var(--wb-${(i % 5) + 1})`

export function KpiWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: KpiData
}) {
  const items: KpiItem[] = data?.items ?? []

  const nums = items.map((it) =>
    typeof it?.value === "number" ? it.value : Number(it?.value)
  )
  const allNumeric =
    items.length > 0 &&
    items.every((it, i) => it?.value !== null && it?.value !== undefined && !Number.isNaN(nums[i]))
  const sameUnit = new Set(items.map((it) => it?.unit ?? "")).size === 1
  // 同单位的数值组 → 自动加对比条(榜单/排行最直观);options.bars 可显式开关
  const showBars =
    (widget.options?.bars as boolean | undefined) ??
    (allNumeric && sameUnit && items.length >= 2)
  const max = allNumeric ? Math.max(...nums, 0) : 0

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="overflow-auto"
    >
      {items.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <div
          className={cn(
            "grid content-start gap-x-4 gap-y-4",
            items.length <= 1 ? "grid-cols-1" : "grid-cols-2"
          )}
        >
          {items.map((it, i) => {
            const dir = (it?.deltaDir as keyof typeof DELTA) || "flat"
            const d = DELTA[dir] ?? DELTA.flat
            const hasValue = it?.value !== null && it?.value !== undefined
            const isCurrency = !!it?.unit && CURRENCY.has(it.unit)
            const pct =
              showBars && allNumeric && max > 0
                ? Math.max(6, Math.round((nums[i] / max) * 100))
                : 0
            return (
              <div key={i} className="flex min-w-0 flex-col gap-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorOf(i) }}
                    aria-hidden
                  />
                  <span className="truncate">{it?.label}</span>
                </span>
                <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
                  {!hasValue ? (
                    "—"
                  ) : isCurrency ? (
                    <>
                      <span className="mr-0.5 text-lg font-medium text-muted-foreground">
                        {it.unit}
                      </span>
                      {it.value}
                    </>
                  ) : (
                    <>
                      {it.value}
                      {it?.unit ? (
                        <span className="ml-1 text-sm font-medium text-muted-foreground">
                          {it.unit}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
                {showBars && allNumeric ? (
                  <div
                    data-testid="kpi-bar"
                    className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: colorOf(i) }}
                    />
                  </div>
                ) : null}
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

import { LineChart, Line, YAxis } from "recharts"
import {
  IconArrowUpRight,
  IconArrowDownRight,
  IconMinus,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import {
  ChartContainer,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard } from "./widget-card"

interface SparklineData {
  label?: string
  value?: number | string | null
  unit?: string
  delta?: number | string | null
  deltaDir?: string
  points?: number[]
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

const sparkConfig: ChartConfig = {
  y: { label: "值", color: "var(--wb-1)" },
}

export function SparklineWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: SparklineData
}) {
  const hasValue = data?.value !== null && data?.value !== undefined
  const dir = ((data?.deltaDir as keyof typeof DELTA) || "flat") as keyof typeof DELTA
  const d = DELTA[dir] ?? DELTA.flat
  const points = data?.points ?? []
  const hasPoints = points.length > 1
  const sparkData = points.map((y, x) => ({ x, y }))

  return (
    <WidgetCard title={widget.title} subtitle={widget.subtitle}>
      <div className="flex h-full flex-col justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          {data?.label ? (
            <span className="truncate text-xs font-medium text-muted-foreground">
              {data.label}
            </span>
          ) : null}
          <span className="text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-foreground">
            {hasValue ? (
              <>
                {data?.unit ? (
                  <span className="mr-0.5 text-lg font-medium text-muted-foreground">
                    {data.unit}
                  </span>
                ) : null}
                {data.value}
              </>
            ) : (
              "—"
            )}
          </span>
          {data?.delta != null ? (
            <span
              className={cn(
                "inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums",
                d.cls
              )}
            >
              <d.Icon className="size-3" />
              {data.delta}
            </span>
          ) : null}
        </div>
        {hasPoints ? (
          <ChartContainer config={sparkConfig} className="h-16 w-full">
            <LineChart
              data={sparkData}
              margin={{ top: 2, right: 2, left: 2, bottom: 2 }}
            >
              <YAxis hide domain={["dataMin", "dataMax"]} />
              <Line
                dataKey="y"
                stroke="var(--wb-1)"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        ) : null}
      </div>
    </WidgetCard>
  )
}

import { RadialBarChart, RadialBar, PolarAngleAxis } from "recharts"
import {
  ChartContainer,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

interface GaugeData {
  value?: number | null
  max?: number | null
  label?: string
  unit?: string
}

function clamp(min: number, max: number, val: number) {
  return Math.min(max, Math.max(min, val))
}

const config: ChartConfig = {
  value: { label: "值", color: "var(--wb-1)" },
}

export function GaugeWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: GaugeData
}) {
  const hasValue = data?.value != null
  const max = data?.max && data.max > 0 ? data.max : 100
  const pct = hasValue ? clamp(0, 100, (data.value! / max) * 100) : 0
  const hasCustomMax = data?.max != null && data.max > 0

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="pb-3"
    >
      {!hasValue ? (
        <WidgetEmpty />
      ) : (
        <div className="relative h-full">
          <ChartContainer config={config} className="h-full w-full">
            <RadialBarChart
              data={[{ name: "v", value: pct }]}
              startAngle={210}
              endAngle={-30}
              innerRadius="68%"
              outerRadius="100%"
              barSize={14}
            >
              <PolarAngleAxis
                type="number"
                domain={[0, 100]}
                tick={false}
              />
              <RadialBar
                dataKey="value"
                cornerRadius={8}
                fill="var(--wb-1)"
                background={{ fill: "var(--muted)" }}
              />
            </RadialBarChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-2xl font-semibold tabular-nums text-foreground">
              {data.unit ? (
                <span className="mr-0.5 text-base font-medium text-muted-foreground">
                  {data.unit}
                </span>
              ) : null}
              {data.value}
              {hasCustomMax ? (
                <span className="text-sm font-normal text-muted-foreground">
                  {" "}/ {max}
                </span>
              ) : (
                <span className="text-sm font-normal text-muted-foreground">%</span>
              )}
            </span>
            {data.label ? (
              <span className="text-xs text-muted-foreground">{data.label}</span>
            ) : null}
          </div>
        </div>
      )}
    </WidgetCard>
  )
}

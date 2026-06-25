import { RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import type { WorkbenchWidget } from "@/types/workbench"
import { WidgetCard, WidgetEmpty } from "./widget-card"

interface RadarSeriesItem {
  key: string
  label: string
  color?: string
}

interface RadarData {
  rows?: object[]
  axisKey?: string
  series?: RadarSeriesItem[]
}

export function RadarWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: RadarData
}) {
  const rows = data?.rows ?? []
  const series = data?.series ?? []
  const axisKey = data?.axisKey ?? "axis"

  const isEmpty = rows.length === 0 || series.length === 0

  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.key,
      {
        label: s.label,
        color: s.color ?? `var(--wb-${(i % 5) + 1})`,
      },
    ])
  )

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="pb-3"
    >
      {isEmpty ? (
        <WidgetEmpty />
      ) : (
        <ChartContainer config={config} className="h-full w-full">
          <RadarChart data={rows}>
            <PolarGrid />
            <PolarAngleAxis dataKey={axisKey} className="text-xs" />
            {series.map((s) => (
              <Radar
                key={s.key}
                dataKey={s.key}
                stroke={`var(--color-${s.key})`}
                fill={`var(--color-${s.key})`}
                fillOpacity={0.15}
              />
            ))}
            <ChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 ? (
              <ChartLegend content={<ChartLegendContent />} />
            ) : null}
          </RadarChart>
        </ChartContainer>
      )}
    </WidgetCard>
  )
}

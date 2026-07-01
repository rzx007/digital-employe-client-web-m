import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"
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

interface ScatterPoint {
  x: number
  y: number
  name?: string
}

interface ScatterSeriesItem {
  name: string
  color?: string
  points: ScatterPoint[]
}

interface ScatterData {
  points?: ScatterPoint[]
  series?: ScatterSeriesItem[]
  xLabel?: string
  yLabel?: string
}

export function ScatterWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: ScatterData
}) {
  const rawSeries: ScatterSeriesItem[] =
    data?.series ??
    (data?.points ? [{ name: widget.title, points: data.points }] : [])

  const series = rawSeries.filter((s) => s.points && s.points.length > 0)

  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.name,
      {
        label: s.name,
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
      {series.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <ChartContainer config={config} className="h-full w-full">
          <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              name={data?.xLabel}
              tickLine={false}
              axisLine={false}
              className="text-xs"
            />
            <YAxis
              type="number"
              dataKey="y"
              name={data?.yLabel}
              width={36}
              tickLine={false}
              axisLine={false}
              className="text-xs"
            />
            <ChartTooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<ChartTooltipContent />}
            />
            {series.map((s, i) => (
              <Scatter
                key={s.name}
                data={s.points}
                fill={s.color ?? `var(--wb-${(i % 5) + 1})`}
              />
            ))}
            {series.length > 1 ? (
              <ChartLegend content={<ChartLegendContent />} />
            ) : null}
          </ScatterChart>
        </ChartContainer>
      )}
    </WidgetCard>
  )
}

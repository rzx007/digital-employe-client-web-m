import {
  LineChart,
  AreaChart,
  BarChart,
  Line,
  Area,
  Bar,
  CartesianGrid,
  XAxis,
} from "recharts"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import type { WorkbenchWidget } from "@/types/workbench"

interface SeriesDef {
  key: string
  label: string
  color?: string
}

interface ChartData {
  rows?: object[]
  xKey?: string
  series?: SeriesDef[]
}

export function ChartWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: ChartData
}) {
  const rows = data?.rows ?? []
  const xKey = data?.xKey ?? "x"
  const series: SeriesDef[] = data?.series ?? []

  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.key,
      {
        label: s.label,
        color: s.color ?? `var(--chart-${i + 1})`,
      },
    ])
  )

  const type = widget.type

  const renderSeries = () => {
    if (type === "line") {
      return series.map((s) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          stroke={`var(--color-${s.key})`}
          dot={false}
        />
      ))
    }
    if (type === "area") {
      return series.map((s) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          stroke={`var(--color-${s.key})`}
          fill={`var(--color-${s.key})`}
          fillOpacity={0.2}
        />
      ))
    }
    // bar
    return series.map((s) => (
      <Bar key={s.key} dataKey={s.key} fill={`var(--color-${s.key})`} />
    ))
  }

  const ChartComponent =
    type === "line" ? LineChart : type === "area" ? AreaChart : BarChart

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">
            暂无数据
          </div>
        ) : (
          <ChartContainer config={config}>
            <ChartComponent data={rows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={xKey} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              {renderSeries()}
            </ChartComponent>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

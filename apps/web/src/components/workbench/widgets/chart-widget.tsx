import {
  AreaChart,
  BarChart,
  Area,
  Bar,
  CartesianGrid,
  XAxis,
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

interface SeriesDef {
  key: string
  label: string
  color?: string
}

interface ChartData {
  rows?: Record<string, unknown>[]
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
  const type = widget.type

  // 默认走工作台数据色板(品牌靛蓝锚定),而非全局灰阶 chart-*
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [
      s.key,
      { label: s.label, color: s.color ?? `var(--wb-${(i % 5) + 1})` },
    ])
  )

  const renderSeries = () => {
    // line 与 area 都用 Area 渲染:line 走更淡的线下渐变(体积感但不抢眼),area 渐变更实
    if (type === "line" || type === "area") {
      const gid = type === "line" ? "line" : "fill"
      return series.map((s) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          stroke={`var(--color-${s.key})`}
          strokeWidth={2}
          fill={`url(#${gid}-${widget.id}-${s.key})`}
          dot={false}
          activeDot={{ r: 3 }}
        />
      ))
    }
    return series.map((s) => (
      <Bar
        key={s.key}
        dataKey={s.key}
        fill={`url(#bar-${widget.id}-${s.key})`}
        radius={[4, 4, 0, 0]}
        maxBarSize={48}
      />
    ))
  }

  const ChartComponent =
    type === "line" || type === "area" ? AreaChart : BarChart

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="pb-3"
    >
      {rows.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <ChartContainer config={config} className="h-full w-full">
          <ChartComponent
            data={rows}
            margin={{ top: 8, right: 8, left: 4, bottom: 0 }}
          >
            <defs>
              {type === "area"
                ? series.map((s) => (
                    <linearGradient
                      key={s.key}
                      id={`fill-${widget.id}-${s.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0.28}
                      />
                      <stop
                        offset="100%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0.02}
                      />
                    </linearGradient>
                  ))
                : null}
              {type === "line"
                ? series.map((s) => (
                    <linearGradient
                      key={s.key}
                      id={`line-${widget.id}-${s.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0.18}
                      />
                      <stop
                        offset="100%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0}
                      />
                    </linearGradient>
                  ))
                : null}
              {type === "bar"
                ? series.map((s) => (
                    <linearGradient
                      key={s.key}
                      id={`bar-${widget.id}-${s.key}`}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0.95}
                      />
                      <stop
                        offset="100%"
                        stopColor={`var(--color-${s.key})`}
                        stopOpacity={0.5}
                      />
                    </linearGradient>
                  ))
                : null}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey={xKey}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
              className="text-xs"
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            {series.length > 1 ? (
              <ChartLegend content={<ChartLegendContent />} />
            ) : null}
            {renderSeries()}
          </ChartComponent>
        </ChartContainer>
      )}
    </WidgetCard>
  )
}

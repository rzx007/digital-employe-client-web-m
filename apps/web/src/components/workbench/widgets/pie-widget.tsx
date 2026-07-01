import { PieChart, Pie, Cell } from "recharts"
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

interface PieItem {
  name: string
  value: number | null
  color?: string
}

interface PieData {
  items?: PieItem[]
}

// 显式给每片上色(工作台数据色板,品牌靛蓝锚定),不依赖 --color-<中文名> 注入
const colorOf = (it: PieItem, i: number) =>
  it.color ?? `var(--wb-${(i % 5) + 1})`

export function PieWidget({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: PieData
}) {
  const items = (data?.items ?? []).filter(
    (it) => it && it.value !== null && it.value !== undefined
  )
  const donut = Boolean(widget.options?.donut)

  // config 仅用于图例/tooltip 的标签与色块
  const config: ChartConfig = Object.fromEntries(
    items.map((it, i) => [
      it.name,
      { label: it.name, color: colorOf(it, i) },
    ])
  )

  return (
    <WidgetCard
      title={widget.title}
      subtitle={widget.subtitle}
      bodyClassName="pb-3"
    >
      {items.length === 0 ? (
        <WidgetEmpty />
      ) : (
        <ChartContainer config={config} className="h-full w-full">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius={donut ? "55%" : 0}
              outerRadius="82%"
              paddingAngle={items.length > 1 ? 2 : 0}
              stroke="var(--card)"
              strokeWidth={1.5}
            >
              {items.map((it, i) => (
                <Cell key={i} fill={colorOf(it, i)} />
              ))}
            </Pie>
            <ChartLegend
              content={<ChartLegendContent nameKey="name" />}
              className="flex-wrap"
            />
          </PieChart>
        </ChartContainer>
      )}
    </WidgetCard>
  )
}

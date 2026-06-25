import type { WorkbenchWidget } from "@/types/workbench"
import { useMetricData } from "@/hooks/use-metric-data"
import { KpiWidget } from "./kpi-widget"
import { ChartWidget } from "./chart-widget"
import { PieWidget } from "./pie-widget"
import { TableWidget } from "./table-widget"
import { ProgressWidget } from "./progress-widget"
import { ListWidget } from "./list-widget"
import { WidgetCard, WidgetEmpty } from "./widget-card"

const REGISTRY: Record<
  string,
  React.ComponentType<{ widget: WorkbenchWidget; data: any }>
> = {
  kpi: KpiWidget,
  line: ChartWidget,
  bar: ChartWidget,
  area: ChartWidget,
  pie: PieWidget,
  table: TableWidget,
  progress: ProgressWidget,
  list: ListWidget,
}

export function WidgetBody({
  widget,
  data,
}: {
  widget: WorkbenchWidget
  data: any
}) {
  const Comp = REGISTRY[widget.type]
  if (!Comp) {
    return (
      <WidgetCard title={widget.title} subtitle={widget.subtitle}>
        <WidgetEmpty label={`不支持的组件类型: ${widget.type}`} />
      </WidgetCard>
    )
  }
  return <Comp widget={widget} data={data} />
}

function WidgetSkeleton({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  return (
    <WidgetCard title={title} subtitle={subtitle}>
      <div className="flex h-full flex-col justify-center gap-3">
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
      </div>
    </WidgetCard>
  )
}

export function WidgetRenderer({ widget }: { widget: WorkbenchWidget }) {
  const q = useMetricData(widget.dataSource)
  // 实时数据源首次加载、且无内联兜底时,显示骨架屏(区别于"真的没数据")
  if (widget.dataSource && q.isLoading && !widget.data) {
    return <WidgetSkeleton title={widget.title} subtitle={widget.subtitle} />
  }
  const data = widget.dataSource
    ? (q.data ?? widget.data ?? {})
    : (widget.data ?? {})
  return <WidgetBody widget={widget} data={data} />
}

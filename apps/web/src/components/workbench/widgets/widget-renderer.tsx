import type { WorkbenchWidget } from "@/types/workbench"
import { useMetricData } from "@/hooks/use-metric-data"
import { KpiWidget } from "./kpi-widget"
import { ChartWidget } from "./chart-widget"
import { TableWidget } from "./table-widget"
import { ProgressWidget } from "./progress-widget"
import { ListWidget } from "./list-widget"

const REGISTRY: Record<
  string,
  React.ComponentType<{ widget: WorkbenchWidget; data: any }>
> = {
  kpi: KpiWidget,
  line: ChartWidget,
  bar: ChartWidget,
  area: ChartWidget,
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
      <div className="p-3 text-xs text-muted-foreground">
        不支持的组件类型: {widget.type}
      </div>
    )
  }
  return <Comp widget={widget} data={data} />
}

export function WidgetRenderer({ widget }: { widget: WorkbenchWidget }) {
  const q = useMetricData(widget.dataSource)
  // 实时数据源首次加载、且无内联兜底时,显示加载态以区别于"真的没数据"
  if (widget.dataSource && q.isLoading && !widget.data) {
    return (
      <div className="flex h-full items-center justify-center p-3 text-xs text-muted-foreground">
        加载中…
      </div>
    )
  }
  const data = widget.dataSource
    ? (q.data ?? widget.data ?? {})
    : (widget.data ?? {})
  return <WidgetBody widget={widget} data={data} />
}

import { useQuery } from "@tanstack/react-query"
import { resolveMetric } from "@/api/workbench"
import type { WidgetDataSource } from "@/types/workbench"

export function useMetricData(src: WidgetDataSource | undefined) {
  return useQuery({
    queryKey: ["metric", src?.metricId, src?.params],
    queryFn: () => resolveMetric(src!.metricId, src!.params ?? {}),
    enabled: !!src,
    refetchInterval: src?.refreshSec ? src.refreshSec * 1000 : false,
  })
}

import { useCapability } from "@/lib/runtime/runtime-provider"
import { PerformanceMetricsCard } from "./performance-metrics-card"

export function WorkbenchPerformanceSection() {
  const canPerformance = useCapability("remote_performance")
  if (!canPerformance) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium text-muted-foreground">
        考核指标
      </div>
      <PerformanceMetricsCard compact />
    </div>
  )
}

import { request } from "@/lib/request"
import type { WorkbenchConfig } from "@/types/workbench"

export async function fetchWorkbench(opts?: { signal?: AbortSignal }) {
  return request<WorkbenchConfig>("/workbench", {
    ...(opts?.signal ? { signal: opts.signal } : {}),
  })
}

export async function saveWorkbench(config: WorkbenchConfig) {
  return request<WorkbenchConfig>("/workbench", { method: "PUT", body: config })
}

export async function resolveMetric(
  metricId: string,
  params: Record<string, unknown> = {}
) {
  return request<Record<string, any>>(`/workbench/metrics/${metricId}/resolve`, {
    method: "POST",
    body: params,
  })
}

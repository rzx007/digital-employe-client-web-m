import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { fetchWorkbench, saveWorkbench } from "@/api/workbench"
import type { WorkbenchConfig } from "@/types/workbench"
import { WORKBENCH_CONFIG_CHANGED_EVENT } from "@/lib/workbench/workbench-config"
import { useWorkspaceEvents } from "@/hooks/use-workspace-events"

const KEY = ["workbench", "config"]

export function useWorkbenchConfig() {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: KEY,
    queryFn: ({ signal }) => fetchWorkbench({ signal }),
  })

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = useMutation({
    mutationFn: saveWorkbench,
    onSuccess: (cfg) => qc.setQueryData(KEY, cfg),
  })

  const mutate = useCallback(
    (next: WorkbenchConfig) => {
      qc.setQueryData(KEY, next) // 乐观
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(
        () => save.mutate({ ...next, updatedAt: Date.now() }),
        400
      )
    },
    [qc, save]
  )

  useEffect(() => {
    const h = () => void qc.invalidateQueries({ queryKey: KEY })
    window.addEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, h)
    return () => window.removeEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, h)
  }, [qc])

  // 总管(后端)经工具改了工作台配置 → 收到 workbench_changed 事件就重新拉,
  // 否则后端加的 widget 不刷新页面不会出现(且可能被前端整份 PUT 覆盖丢失)
  useWorkspaceEvents((event) => {
    if (event.type === "workbench_changed") {
      void qc.invalidateQueries({ queryKey: KEY })
    }
  })

  // 卸载时清掉防抖定时器,并把最后一次乐观结果同步落库(防止快速切走丢失最后一次编辑)
  useEffect(() => {
    return () => {
      if (!timer.current) return
      clearTimeout(timer.current)
      const cached = qc.getQueryData<WorkbenchConfig>(KEY)
      if (cached) void saveWorkbench({ ...cached, updatedAt: Date.now() })
    }
  }, [qc])

  return { config: query.data ?? null, isLoading: query.isLoading, mutate }
}

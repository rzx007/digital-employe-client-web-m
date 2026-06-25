import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { fetchWorkbench, saveWorkbench } from "@/api/workbench"
import type { WorkbenchConfig } from "@/types/workbench"
import { WORKBENCH_CONFIG_CHANGED_EVENT } from "@/lib/workbench/workbench-config"

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

  return { config: query.data ?? null, isLoading: query.isLoading, mutate }
}

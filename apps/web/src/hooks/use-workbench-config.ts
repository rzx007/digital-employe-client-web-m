import { useCallback, useEffect, useState } from "react"
import type { GridPos, GridSpan, WorkbenchConfig } from "@/types/workbench"
import {
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
  removeBlock,
  setBlockPos,
  setBlockSpan,
  WORKBENCH_CONFIG_CHANGED_EVENT,
} from "@/lib/workbench/workbench-config"

interface UseWorkbenchConfigOptions {
  /** null 时不加载（如数据未就绪）；工作台固定传 "global" */
  employeeId: string | null
}

export function useWorkbenchConfig({ employeeId }: UseWorkbenchConfigOptions) {
  const [prevEmployeeId, setPrevEmployeeId] = useState(employeeId)

  const [config, setConfig] = useState<WorkbenchConfig | null>(() => {
    if (!employeeId) return null
    return loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
  })

  if (employeeId !== prevEmployeeId) {
    setPrevEmployeeId(employeeId)
    if (!employeeId) {
      setConfig(null)
    } else {
      setConfig(
        loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
      )
    }
  }

  const refreshConfig = useCallback(() => {
    if (!employeeId) return
    setConfig(
      loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId)
    )
  }, [employeeId])

  // 资源面板钉住产物后会派发 WORKBENCH_CONFIG_CHANGED_EVENT，这里重读配置，
  // 让新看板立即出现（无需切菜单再切回）。
  useEffect(() => {
    if (!employeeId) return
    const handler = () => refreshConfig()
    window.addEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, handler)
    return () => {
      window.removeEventListener(WORKBENCH_CONFIG_CHANGED_EVENT, handler)
    }
  }, [employeeId, refreshConfig])

  const removeBlockById = useCallback((blockId: string) => {
    setConfig((prev) => (prev ? removeBlock(prev, blockId) : prev))
  }, [])

  const resizeBlock = useCallback((blockId: string, span: GridSpan) => {
    setConfig((prev) => (prev ? setBlockSpan(prev, blockId, span) : prev))
  }, [])

  const moveBlock = useCallback((blockId: string, pos: GridPos) => {
    setConfig((prev) => (prev ? setBlockPos(prev, blockId, pos) : prev))
  }, [])

  return {
    config,
    removeBlock: removeBlockById,
    resizeBlock,
    moveBlock,
    refreshConfig,
  }
}

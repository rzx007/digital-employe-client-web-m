import { useCallback, useState } from "react"
import type { HtmlArtifactRef, WorkbenchConfig } from "@/types/workbench"
import {
  addHtmlArtifactBlock,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
  removeBlock,
  updateBlockOrder,
  updateBlockSize,
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

  const reorderBlocks = useCallback(
    (blockIds: string[]) => {
      setConfig((prev) => (prev ? updateBlockOrder(prev, blockIds) : prev))
    },
    []
  )

  const pinHtmlArtifact = useCallback(
    (htmlRef: HtmlArtifactRef, title: string) => {
      setConfig((prev) =>
        prev ? addHtmlArtifactBlock(prev, htmlRef, title) : prev
      )
    },
    []
  )

  const removeBlockById = useCallback((blockId: string) => {
    setConfig((prev) => (prev ? removeBlock(prev, blockId) : prev))
  }, [])

  const resizeBlock = useCallback(
    (blockId: string, width: number, height: number) => {
      setConfig((prev) =>
        prev ? updateBlockSize(prev, blockId, width, height) : prev
      )
    },
    []
  )

  return {
    config,
    reorderBlocks,
    pinHtmlArtifact,
    removeBlock: removeBlockById,
    resizeBlock,
    refreshConfig,
  }
}

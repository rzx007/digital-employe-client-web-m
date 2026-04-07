import { useCallback, useState } from "react"
import type { MetadataSkill } from "@/api/types"
import type { QueryInterface, WorkbenchConfig } from "@/types/workbench"
import {
  addCustomBlock,
  initializeWorkbenchConfig,
  loadWorkbenchConfig,
  removeBlock,
  toggleBlock,
  updateBlockOrder,
  updateBlockSize,
} from "@/lib/workbench/workbench-config"

interface UseWorkbenchConfigOptions {
  employeeId: string | null
  skills: MetadataSkill[]
}

export function useWorkbenchConfig({ employeeId, skills }: UseWorkbenchConfigOptions) {
  const [config, setConfig] = useState<WorkbenchConfig | null>(() => {
    if (!employeeId) return null
    return loadWorkbenchConfig(employeeId) ?? initializeWorkbenchConfig(employeeId, skills)
  })

  const refreshConfig = useCallback(() => {
    if (!employeeId) return
    const loaded = loadWorkbenchConfig(employeeId)
    if (loaded) {
      setConfig(loaded)
    } else {
      const initialized = initializeWorkbenchConfig(employeeId, skills)
      setConfig(initialized)
    }
  }, [employeeId, skills])

  const toggleBlockEnabled = useCallback(
    (blockId: string) => {
      if (!config) return
      const updated = toggleBlock(config, blockId)
      setConfig(updated)
    },
    [config]
  )

  const reorderBlocks = useCallback(
    (blockIds: string[]) => {
      if (!config) return
      const updated = updateBlockOrder(config, blockIds)
      setConfig(updated)
    },
    [config]
  )

  const addBlock = useCallback(
    (queryInterface: QueryInterface) => {
      if (!config) return
      const updated = addCustomBlock(config, queryInterface)
      setConfig(updated)
    },
    [config]
  )

  const removeBlockById = useCallback(
    (blockId: string) => {
      if (!config) return
      const updated = removeBlock(config, blockId)
      setConfig(updated)
    },
    [config]
  )

  const resizeBlock = useCallback(
    (blockId: string, width: number, height: number) => {
      if (!config) return
      const updated = updateBlockSize(config, blockId, width, height)
      setConfig(updated)
    },
    [config]
  )

  return {
    config,
    toggleBlockEnabled,
    reorderBlocks,
    addBlock,
    removeBlock: removeBlockById,
    resizeBlock,
    refreshConfig,
  }
}

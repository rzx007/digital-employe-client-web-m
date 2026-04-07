import type { MetadataSkill } from "@/api/types"
import type { QueryInterface, WorkbenchBlock, WorkbenchConfig } from "@/types/workbench"
import {
  generateBlockId,
  getBlockTitleForSkill,
  getBlockTypeForSkill,
} from "./skill-block-mappings"

const STORAGE_KEY_PREFIX = "workbench-config-"

/**
 * Get storage key for an employee
 */
function getStorageKey(employeeId: string): string {
  return `${STORAGE_KEY_PREFIX}${employeeId}`
}

/**
 * Load workbench config from localStorage
 */
export function loadWorkbenchConfig(employeeId: string): WorkbenchConfig | null {
  try {
    const raw = localStorage.getItem(getStorageKey(employeeId))
    if (!raw) return null
    return JSON.parse(raw) as WorkbenchConfig
  } catch {
    return null
  }
}

/**
 * Save workbench config to localStorage
 */
export function saveWorkbenchConfig(config: WorkbenchConfig): void {
  try {
    localStorage.setItem(getStorageKey(config.employeeId), JSON.stringify(config))
  } catch (e) {
    console.error("Failed to save workbench config:", e)
  }
}

/**
 * Create initial blocks from employee skills
 */
export function createBlocksFromSkills(skills: MetadataSkill[]): WorkbenchBlock[] {
  const blocks: WorkbenchBlock[] = []
  const seenTypes = new Set<BlockType>()

  for (const skill of skills) {
    if (skill.status !== 1) continue // Only enabled skills

    const blockType = getBlockTypeForSkill(skill)

    // Skip if we've already seen this block type (avoid duplicates)
    if (seenTypes.has(blockType)) continue
    seenTypes.add(blockType)

    blocks.push({
      id: generateBlockId(blockType, skill.id),
      type: blockType,
      title: getBlockTitleForSkill(skill),
      enabled: true,
      skillId: skill.id,
      order: blocks.length,
    })
  }

  return blocks
}

/**
 * Initialize workbench config for an employee
 */
export function initializeWorkbenchConfig(
  employeeId: string,
  skills: MetadataSkill[]
): WorkbenchConfig {
  const existingConfig = loadWorkbenchConfig(employeeId)

  // If config exists, just update lastModified
  if (existingConfig) {
    existingConfig.lastModified = Date.now()
    saveWorkbenchConfig(existingConfig)
    return existingConfig
  }

  // Create new config from skills
  const config: WorkbenchConfig = {
    employeeId,
    blocks: createBlocksFromSkills(skills),
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(config)
  return config
}

/**
 * Update block order after drag
 */
export function updateBlockOrder(
  config: WorkbenchConfig,
  blockIds: string[]
): WorkbenchConfig {
  const blockMap = new Map(config.blocks.map((b) => [b.id, b]))
  const reorderedBlocks = blockIds
    .map((id, index) => {
      const block = blockMap.get(id)
      if (!block) return null
      return { ...block, order: index }
    })
    .filter((b): b is WorkbenchBlock => b !== null)

  const updatedConfig: WorkbenchConfig = {
    ...config,
    blocks: reorderedBlocks,
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(updatedConfig)
  return updatedConfig
}

/**
 * Toggle block enabled state
 */
export function toggleBlock(
  config: WorkbenchConfig,
  blockId: string
): WorkbenchConfig {
  const updatedBlocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, enabled: !b.enabled } : b
  )

  const updatedConfig: WorkbenchConfig = {
    ...config,
    blocks: updatedBlocks,
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(updatedConfig)
  return updatedConfig
}

/**
 * Add a custom interface block to workbench
 */
export function addCustomBlock(
  config: WorkbenchConfig,
  queryInterface: QueryInterface
): WorkbenchConfig {
  const newBlock: WorkbenchBlock = {
    id: generateBlockId("custom", null),
    type: "custom",
    title: queryInterface.name,
    enabled: true,
    skillId: null,
    order: config.blocks.length,
    queryInterface,
  }

  const updatedConfig: WorkbenchConfig = {
    ...config,
    blocks: [...config.blocks, newBlock],
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(updatedConfig)
  return updatedConfig
}

/**
 * Remove a block from workbench
 */
export function removeBlock(
  config: WorkbenchConfig,
  blockId: string
): WorkbenchConfig {
  const updatedBlocks = config.blocks.filter((b) => b.id !== blockId)

  // Re-order remaining blocks
  const reorderedBlocks = updatedBlocks.map((b, index) => ({
    ...b,
    order: index,
  }))

  const updatedConfig: WorkbenchConfig = {
    ...config,
    blocks: reorderedBlocks,
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(updatedConfig)
  return updatedConfig
}

/**
 * Update block size (width/height)
 */
export function updateBlockSize(
  config: WorkbenchConfig,
  blockId: string,
  width: number,
  height: number
): WorkbenchConfig {
  const updatedBlocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, width, height } : b
  )

  const updatedConfig: WorkbenchConfig = {
    ...config,
    blocks: updatedBlocks,
    lastModified: Date.now(),
  }

  saveWorkbenchConfig(updatedConfig)
  return updatedConfig
}

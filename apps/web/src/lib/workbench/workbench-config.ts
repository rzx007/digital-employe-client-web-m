import type { HtmlArtifactRef, WorkbenchBlock, WorkbenchConfig } from "@/types/workbench"

const STORAGE_KEY_PREFIX = "workbench-config-"

function getStorageKey(employeeId: string): string {
  return `${STORAGE_KEY_PREFIX}${employeeId}`
}

/** 生成唯一 block id（不依赖 Date.now，避免与 mock 冲突；用随机串足够） */
function generateBlockId(): string {
  return `wb-${Math.random().toString(36).slice(2, 10)}`
}

/** 校验是否为重构后的合法 config（所有 block 必须是 html-artifact + 带 htmlRef） */
function isValidConfig(raw: unknown): raw is WorkbenchConfig {
  if (!raw || typeof raw !== "object") return false
  const cfg = raw as WorkbenchConfig
  if (!Array.isArray(cfg.blocks)) return false
  return cfg.blocks.every(
    (b) =>
      b &&
      typeof b === "object" &&
      (b as WorkbenchBlock).type === "html-artifact" &&
      !!(b as WorkbenchBlock).htmlRef &&
      typeof (b as WorkbenchBlock).htmlRef.resourcePath === "string"
  )
}

/**
 * 从 localStorage 加载工作台配置；检测到旧结构（含 queryInterface / 非 html-artifact）
 * 一律重置为 null（调用方据此初始化空白工作台），并 console.warn 提示，不静默。
 */
export function loadWorkbenchConfig(employeeId: string): WorkbenchConfig | null {
  try {
    const raw = localStorage.getItem(getStorageKey(employeeId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isValidConfig(parsed)) {
      console.warn(
        "[workbench] 检测到旧版工作台配置（不兼容新看板模型），已重置为空白工作台"
      )
      localStorage.removeItem(getStorageKey(employeeId))
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveWorkbenchConfig(config: WorkbenchConfig): void {
  try {
    localStorage.setItem(getStorageKey(config.employeeId), JSON.stringify(config))
  } catch (e) {
    console.error("Failed to save workbench config:", e)
  }
}

/** 初始化空白工作台配置（不再从技能创建块） */
export function initializeWorkbenchConfig(employeeId: string): WorkbenchConfig {
  const existing = loadWorkbenchConfig(employeeId)
  if (existing) {
    existing.lastModified = Date.now()
    saveWorkbenchConfig(existing)
    return existing
  }
  const config: WorkbenchConfig = {
    employeeId,
    blocks: [],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(config)
  return config
}

/** 把一个总管生成的 HTML 产物钉成看板块 */
export function addHtmlArtifactBlock(
  config: WorkbenchConfig,
  htmlRef: HtmlArtifactRef,
  title: string
): WorkbenchConfig {
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title,
    enabled: true,
    order: config.blocks.length,
    htmlRef,
  }
  const updated: WorkbenchConfig = {
    ...config,
    blocks: [...config.blocks, newBlock],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function updateBlockOrder(
  config: WorkbenchConfig,
  blockIds: string[]
): WorkbenchConfig {
  const blockMap = new Map(config.blocks.map((b) => [b.id, b]))
  const reordered = blockIds
    .map((id, index) => {
      const block = blockMap.get(id)
      if (!block) return null
      return { ...block, order: index }
    })
    .filter((b): b is WorkbenchBlock => b !== null)
  const updated: WorkbenchConfig = {
    ...config,
    blocks: reordered,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function removeBlock(
  config: WorkbenchConfig,
  blockId: string
): WorkbenchConfig {
  const reordered = config.blocks
    .filter((b) => b.id !== blockId)
    .map((b, index) => ({ ...b, order: index }))
  const updated: WorkbenchConfig = {
    ...config,
    blocks: reordered,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

export function updateBlockSize(
  config: WorkbenchConfig,
  blockId: string,
  width: number,
  height: number
): WorkbenchConfig {
  const updatedBlocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, width, height } : b
  )
  const updated: WorkbenchConfig = {
    ...config,
    blocks: updatedBlocks,
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(updated)
  return updated
}

import type {
  GridPos,
  GridSpan,
  HtmlArtifactRef,
  WorkbenchArrangeOp,
  WorkbenchBlock,
  WorkbenchConfig,
} from "@/types/workbench"
import { findFreeSlot, SPAN_PRESETS } from "./grid"

/**
 * 单一全局工作台的 employeeId。钉住写入方（资源面板）与读取方（WorkbenchView）
 * 必须共用此常量，否则写入的看板读不出来。
 */
export const GLOBAL_WORKBENCH_ID = "global"

/**
 * 工作台配置变更事件名。资源面板钉住产物（直接写 localStorage，不经 useWorkbenchConfig）后
 * 派发此事件，WorkbenchView 监听并重读配置，实现「点钉立即出现在看板」的跨视图联动。
 */
export const WORKBENCH_CONFIG_CHANGED_EVENT = "workbench-config-changed"

/** 派发配置变更事件（仅在浏览器环境）。 */
export function emitWorkbenchConfigChanged(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(WORKBENCH_CONFIG_CHANGED_EVENT))
}

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
      typeof (b as WorkbenchBlock).htmlRef.resourcePath === "string" &&
      !!(b as WorkbenchBlock).gridSpan &&
      typeof (b as WorkbenchBlock).gridSpan.w === "number" &&
      !!(b as WorkbenchBlock).gridPos &&
      typeof (b as WorkbenchBlock).gridPos.x === "number"
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
    const refreshed = { ...existing, lastModified: Date.now() }
    saveWorkbenchConfig(refreshed)
    return refreshed
  }
  const config: WorkbenchConfig = {
    employeeId,
    blocks: [],
    lastModified: Date.now(),
  }
  saveWorkbenchConfig(config)
  return config
}

/** 同一会话 + 同一资源路径视为同一个产物（钉重复时原地更新而非新增重复看板） */
function isSameHtmlRef(a: HtmlArtifactRef, b: HtmlArtifactRef): boolean {
  return (
    String(a.conversationId) === String(b.conversationId) &&
    a.resourcePath === b.resourcePath
  )
}

/**
 * 把一个总管生成的 HTML 产物钉成看板块。
 * 若该产物已被钉过（同会话同路径），更新其标题/钉住时间，不新增重复看板。
 */
export function addHtmlArtifactBlock(
  config: WorkbenchConfig,
  htmlRef: HtmlArtifactRef,
  title: string,
  span: GridSpan = SPAN_PRESETS.medium,
  pos?: GridPos
): WorkbenchConfig {
  const existing = config.blocks.find(
    (b) => b.type === "html-artifact" && isSameHtmlRef(b.htmlRef, htmlRef)
  )
  if (existing) {
    const updated: WorkbenchConfig = {
      ...config,
      blocks: config.blocks.map((b) =>
        b.id === existing.id ? { ...b, title, htmlRef } : b
      ),
      lastModified: Date.now(),
    }
    saveWorkbenchConfig(updated)
    return updated
  }
  const occupied = config.blocks.map((b) => ({ ...b.gridPos, ...b.gridSpan }))
  const resolvedPos = pos ?? findFreeSlot(occupied, span)
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title,
    enabled: true,
    order: config.blocks.length,
    htmlRef,
    gridSpan: span,
    gridPos: resolvedPos,
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

/** 改尺寸（保存）。 */
export function setBlockSpan(
  config: WorkbenchConfig,
  blockId: string,
  span: GridSpan
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, gridSpan: span } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 改位置（保存）。 */
export function setBlockPos(
  config: WorkbenchConfig,
  blockId: string,
  pos: GridPos
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, gridPos: pos } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 改标题（保存）。 */
export function setBlockTitle(
  config: WorkbenchConfig,
  blockId: string,
  title: string
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, title } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 显隐（保存）。 */
export function setBlockEnabled(
  config: WorkbenchConfig,
  blockId: string,
  enabled: boolean
): WorkbenchConfig {
  const blocks = config.blocks.map((b) =>
    b.id === blockId ? { ...b, enabled } : b
  )
  const updated = { ...config, blocks, lastModified: Date.now() }
  saveWorkbenchConfig(updated)
  return updated
}

/** 把 blockRef（标题或 1 基序号）解析为 blockId；找不到返回 null。 */
function resolveBlockRef(
  config: WorkbenchConfig,
  ref: string
): string | null {
  const byTitle = config.blocks.find((b) => b.title === ref)
  if (byTitle) return byTitle.id
  const idx = Number(ref)
  if (Number.isInteger(idx) && idx >= 1 && idx <= config.blocks.length) {
    return config.blocks[idx - 1].id
  }
  return null
}

/** 内存版加块（不 save），供事务复用。 */
function addBlockInMemory(
  config: WorkbenchConfig,
  args: { htmlRef: HtmlArtifactRef; title: string; span: GridSpan; pos?: GridPos }
): WorkbenchConfig {
  const existing = config.blocks.find(
    (b) => b.type === "html-artifact" && isSameHtmlRef(b.htmlRef, args.htmlRef)
  )
  if (existing) {
    return {
      ...config,
      blocks: config.blocks.map((b) =>
        b.id === existing.id ? { ...b, title: args.title, htmlRef: args.htmlRef } : b
      ),
    }
  }
  const occupied = config.blocks.map((b) => ({ ...b.gridPos, ...b.gridSpan }))
  const pos = args.pos ?? findFreeSlot(occupied, args.span)
  const newBlock: WorkbenchBlock = {
    id: generateBlockId(),
    type: "html-artifact",
    title: args.title,
    enabled: true,
    order: config.blocks.length,
    htmlRef: args.htmlRef,
    gridSpan: args.span,
    gridPos: pos,
  }
  return { ...config, blocks: [...config.blocks, newBlock] }
}

/** 内存版改块（不 save）。 */
function mapBlock(
  config: WorkbenchConfig,
  blockId: string,
  fn: (b: WorkbenchBlock) => WorkbenchBlock
): WorkbenchConfig {
  return {
    ...config,
    blocks: config.blocks.map((b) => (b.id === blockId ? fn(b) : b)),
  }
}

/**
 * 事务性应用一批归一化 arrange 指令：在内存里逐条算出新 config，
 * 全部处理完一次性 save。blockRef 找不到的条目跳过。
 * conversationId 用于 pin 指令构造 htmlRef。
 */
export function applyArrangeOperations(
  config: WorkbenchConfig,
  ops: WorkbenchArrangeOp[],
  conversationId: string | number
): WorkbenchConfig {
  let next: WorkbenchConfig = { ...config, blocks: [...config.blocks] }

  for (const op of ops) {
    switch (op.op) {
      case "pin": {
        next = addBlockInMemory(next, {
          htmlRef: { conversationId, resourcePath: op.resourcePath, pinnedAt: Date.now() },
          title: op.title ?? op.resourcePath.split("/").pop()!.replace(/\.html?$/i, ""),
          span: op.span ?? SPAN_PRESETS.medium,
          pos: op.pos,
        })
        break
      }
      case "resize": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, gridSpan: op.span }))
        break
      }
      case "move": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, gridPos: op.pos }))
        break
      }
      case "rename": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, title: op.title }))
        break
      }
      case "hide": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) next = mapBlock(next, id, (b) => ({ ...b, enabled: false }))
        break
      }
      case "remove": {
        const id = resolveBlockRef(next, op.blockRef)
        if (id) {
          next = {
            ...next,
            blocks: next.blocks
              .filter((b) => b.id !== id)
              .map((b, i) => ({ ...b, order: i })),
          }
        }
        break
      }
      case "reorder": {
        const ids = op.order
          .map((ref) => resolveBlockRef(next, ref))
          .filter((x): x is string => x !== null)
        const map = new Map(next.blocks.map((b) => [b.id, b]))
        const reordered = ids
          .map((id, i) => {
            const b = map.get(id)
            return b ? { ...b, order: i } : null
          })
          .filter((b): b is WorkbenchBlock => b !== null)
        // 补上未在 order 里出现的块，接在后面
        const seen = new Set(ids)
        const rest = next.blocks.filter((b) => !seen.has(b.id))
        next = {
          ...next,
          blocks: [...reordered, ...rest].map((b, i) => ({ ...b, order: i })),
        }
        break
      }
    }
  }
  const result = { ...next, lastModified: Date.now() }
  saveWorkbenchConfig(result)
  return result
}
// 注：errors（blockRef 跳过）当前不外传；如需在卡片上提示，可改返回 {config, skipped}。

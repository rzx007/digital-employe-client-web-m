/**
 * ToolRow 延迟收起策略：完成时不立即收起，由父级按工具顺序与会话状态下发 shouldAutoCollapse。
 */
import type {
  ClassifiedBlock,
  ToolGroupItem,
} from "./message-classifier"

export function isToolDone(tool: ToolGroupItem): boolean {
  return (
    (tool.state === "output-available" && !tool.preliminary) ||
    tool.state === "output-error"
  )
}

/** @returns tool.key → 是否应向 ToolRow 下发 shouldAutoCollapse */
export function computeToolAutoCollapseMap(
  blocks: ClassifiedBlock[],
  options: { isLastAssistantMessage: boolean; isTurnEnded: boolean }
): Map<string, boolean> {
  const { isLastAssistantMessage, isTurnEnded } = options
  const allTools: ToolGroupItem[] = []
  for (const block of blocks) {
    if (block.kind === "tool-group") {
      allTools.push(...block.tools)
    } else if (block.kind === "todo-plan") {
      allTools.push(block.tool)
    }
  }

  const map = new Map<string, boolean>()
  const lastIndex = allTools.length - 1

  allTools.forEach((tool, index) => {
    if (!isToolDone(tool)) {
      map.set(tool.key, false)
      return
    }

    if (!isLastAssistantMessage) {
      map.set(tool.key, true)
      return
    }

    if (index < lastIndex) {
      map.set(tool.key, true)
      return
    }

    map.set(tool.key, isTurnEnded)
  })

  return map
}

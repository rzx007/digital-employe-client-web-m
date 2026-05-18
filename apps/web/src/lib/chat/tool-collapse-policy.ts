/**
 * ToolRow 延迟收起策略：完成时不立即收起，由父级按工具顺序与会话状态下发 shouldAutoCollapse。
 */
import type {
  ClassifiedBlock,
  ToolGroupItem,
} from "./message-classifier"

export function isToolDone(tool: ToolGroupItem): boolean {  return (
    (tool.state === "output-available" && !tool.preliminary) ||
    tool.state === "output-error"
  )
}

/** @returns block.key → 是否应向 ToolRow 下发 shouldAutoCollapse */
export function computeToolAutoCollapseMap(
  blocks: ClassifiedBlock[],
  options: { isLastAssistantMessage: boolean; isTurnEnded: boolean }
): Map<string, boolean> {
  const { isLastAssistantMessage, isTurnEnded } = options
  const toolBlocks = blocks.filter(
    (block): block is Extract<ClassifiedBlock, { kind: "tool-group" }> =>
      block.kind === "tool-group"
  )
  const map = new Map<string, boolean>()
  const lastIndex = toolBlocks.length - 1

  toolBlocks.forEach((block, index) => {
    const tool = block.tools[0]
    if (!tool || !isToolDone(tool)) {
      map.set(block.key, false)
      return
    }

    // 历史消息：已完成工具默认收起
    if (!isLastAssistantMessage) {
      map.set(block.key, true)
      return
    }

    // 当前轮非末项：下一块 tool-group 已出现即收起上一项
    if (index < lastIndex) {
      map.set(block.key, true)
      return
    }

    // 当前轮末项：等流式结束（isTurnEnded）再收起
    map.set(block.key, isTurnEnded)
  })

  return map
}

import type { ClassifiedBlock, ToolGroupItem } from "./message-classifier"
import { summarizeToolGroup } from "./tool-summarizer"

/** 分类阶段每个工具各自成一个单工具 tool-group 块，这是合并的基本单元。 */
function asSingleToolGroup(
  block: ClassifiedBlock
): Extract<ClassifiedBlock, { kind: "tool-group" }> | null {
  if (block.kind !== "tool-group") return null
  if (block.tools.length !== 1) return null
  return block
}

/**
 * 将所有「连续」的工具调用合并为单张折叠卡，减少时间线噪声。
 * 任何相邻的单工具 tool-group 块都会合并，不区分工具类型；
 * 被其它块（文本/思考/业务卡等）打断时自然分组。
 * 单个工具仍输出为单工具组，渲染上与未合并时一致。
 */
export function mergeConsecutiveToolGroups(
  blocks: ClassifiedBlock[]
): ClassifiedBlock[] {
  const out: ClassifiedBlock[] = []
  let buffer: ToolGroupItem[] = []
  let groupKey: string | null = null

  const flush = () => {
    if (buffer.length === 0) return
    out.push({
      kind: "tool-group",
      key: groupKey ?? buffer[0].key,
      tools: [...buffer],
      summary: summarizeToolGroup(buffer.map((t) => t.summary)),
    })
    buffer = []
    groupKey = null
  }

  for (const block of blocks) {
    const single = asSingleToolGroup(block)
    if (single) {
      if (buffer.length === 0) groupKey = block.key
      buffer.push(single.tools[0])
    } else {
      flush()
      out.push(block)
    }
  }
  flush()
  return out
}

import type { ClassifiedBlock, ToolGroupItem } from "./message-classifier"
import { isRoutineTool } from "./tool-label-registry"
import { summarizeToolGroup } from "./tool-summarizer"

function isMergeableToolGroup(
  block: ClassifiedBlock
): block is Extract<ClassifiedBlock, { kind: "tool-group" }> {
  if (block.kind !== "tool-group") return false
  if (block.tools.length !== 1) return false
  return isRoutineTool(block.tools[0].toolName)
}

export function mergeRoutineToolGroups(
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
    if (isMergeableToolGroup(block)) {
      if (buffer.length === 0) groupKey = block.key
      buffer.push(block.tools[0])
    } else {
      flush()
      out.push(block)
    }
  }
  flush()
  return out
}

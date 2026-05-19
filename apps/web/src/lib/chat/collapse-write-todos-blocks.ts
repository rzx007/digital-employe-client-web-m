import { getTodos, type TodoItem } from "@/components/chat/message-blocks/tool-shared"
import type { ClassifiedBlock, ToolGroupItem } from "./message-classifier"

function isWriteTodosToolGroup(
  block: ClassifiedBlock
): block is Extract<ClassifiedBlock, { kind: "tool-group" }> {
  if (block.kind !== "tool-group") return false
  if (block.tools.length !== 1) return false
  return block.tools[0].toolName === "write_todos"
}

/**
 * 单条消息内多次 write_todos 合并为一块 todo-plan：
 * 保留首次出现位置的 key，tool/todos 取最后一次有效数据。
 */
export function collapseWriteTodosBlocks(
  blocks: ClassifiedBlock[]
): ClassifiedBlock[] {
  const indices: number[] = []
  let latestTool: ToolGroupItem | null = null
  let latestTodos: TodoItem[] | null = null

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!isWriteTodosToolGroup(block)) continue

    indices.push(i)
    const tool = block.tools[0]
    latestTool = tool
    const todos = getTodos(tool.input, tool.resultText)
    if (todos && todos.length > 0) {
      latestTodos = todos
    }
  }

  if (indices.length === 0 || !latestTool) {
    return blocks
  }

  if (!latestTodos || latestTodos.length === 0) {
    return blocks
  }

  const firstIndex = indices[0]
  const firstBlock = blocks[firstIndex] as Extract<
    ClassifiedBlock,
    { kind: "tool-group" }
  >

  const merged: ClassifiedBlock = {
    kind: "todo-plan",
    key: firstBlock.key,
    tool: latestTool,
    todos: latestTodos,
  }

  const skip = new Set(indices)
  const out: ClassifiedBlock[] = []

  for (let i = 0; i < blocks.length; i++) {
    if (skip.has(i)) {
      if (i === firstIndex) out.push(merged)
      continue
    }
    out.push(blocks[i])
  }

  return out
}

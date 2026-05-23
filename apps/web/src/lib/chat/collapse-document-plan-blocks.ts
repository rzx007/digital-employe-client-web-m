import type { ClassifiedBlock } from "./message-classifier"

function isDocumentPlanBlock(
  block: ClassifiedBlock
): block is Extract<ClassifiedBlock, { kind: "document-plan" }> {
  return block.kind === "document-plan"
}

function isDocumentPlanPending(state: string): boolean {
  return (
    state === "input-available" ||
    state === "input-streaming" ||
    state === "call"
  )
}

export function collapseDocumentPlanBlocks(
  blocks: ClassifiedBlock[]
): ClassifiedBlock[] {
  const indices: number[] = []
  let latest: Extract<ClassifiedBlock, { kind: "document-plan" }> | null = null
  let latestPending: Extract<
    ClassifiedBlock,
    { kind: "document-plan" }
  > | null = null

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (!isDocumentPlanBlock(block)) continue

    indices.push(i)
    latest = block
    if (isDocumentPlanPending(block.state)) {
      latestPending = block
    }
  }

  if (indices.length <= 1 || !latest) {
    return blocks
  }

  const chosen = latestPending ?? latest
  const firstIndex = indices[0]
  const merged: ClassifiedBlock = {
    ...chosen,
    key: blocks[firstIndex].key,
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

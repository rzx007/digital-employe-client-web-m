import type { UIMessage } from "ai"
import { isToolUIPart } from "../tools/tool-part"
import { normalizeToolPart } from "../tools/normalize-tool-part"
import { isConversationResourcePath } from "./paths"

export interface PendingToolSnapshot {
  toolCallId: string
  normalizedFilePath: string
  displayContent: string
  isStreaming: boolean
  isToolComplete: boolean
  isError: boolean
}

export function collectPendingToolSnapshots(
  messages: UIMessage[]
): PendingToolSnapshot[] {
  const snapshots: PendingToolSnapshot[] = []

  // Scanning all assistant messages for tool parts
  for (const message of messages) {
    if (message.role !== "assistant") continue

    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue

      const vm = normalizeToolPart(part)

      const isFileTool = vm.toolName === "write_file" || vm.toolName === "edit_file"
      if (!isFileTool) continue
      if (!vm.normalizedFilePath || !isConversationResourcePath(vm.normalizedFilePath)) continue

      const isPreliminaryOutput = vm.state === "output-available" && vm.preliminary === true
      const isInputStreaming = vm.state === "input-streaming"
      const isDone = (vm.state === "output-available" && !vm.preliminary) || vm.state === "output-error"
      const isRunning = !isDone

      const isError = vm.state === "output-error"
      const isToolComplete = vm.state === "output-available" && !vm.preliminary && !isRunning
      const isStreaming = isInputStreaming || isRunning || isPreliminaryOutput

      snapshots.push({
        toolCallId: vm.toolCallId,
        normalizedFilePath: vm.normalizedFilePath,
        displayContent: vm.displayContent ?? "",
        isStreaming,
        isToolComplete,
        isError,
      })
    }
  }

  return snapshots
}

/** 流式阶段只需扫描最后一条 assistant，避免每条 delta 遍历全历史 */
export function collectPendingToolSnapshotsForActiveTurn(
  messages: UIMessage[]
): PendingToolSnapshot[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return collectPendingToolSnapshots([message])
    }
  }
  return []
}

import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { chatKeys } from "@/lib/query-keys/chat"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"

import { isConversationResourcePath } from "./paths"

export interface SyncPendingResourceFromToolInput {
  toolCallId: string | null
  toolName: string
  state: string
  preliminary?: boolean
  isRunning: boolean
  normalizedFilePath: string | null
  displayContent: string | null
}

export function useSyncPendingResourceFromTool({
  toolCallId,
  toolName,
  state,
  preliminary,
  isRunning,
  normalizedFilePath,
  displayContent,
}: SyncPendingResourceFromToolInput) {
  const upsertPendingResource = useArtifactStore((s) => s.upsertPendingResource)
  const clearPendingResource = useArtifactStore((s) => s.clearPendingResource)
  const conversationId = useChatStore((s) => s.selectedConversationId)
  const queryClient = useQueryClient()

  const isPreliminaryOutput =
    state === "output-available" && preliminary === true
  const isInputStreaming = state === "input-streaming"

  const isFileTool = toolName === "write_file" || toolName === "edit_file"
  const shouldTrackPending =
    isFileTool &&
    !!toolCallId &&
    !!normalizedFilePath &&
    isConversationResourcePath(normalizedFilePath) &&
    (isInputStreaming || isRunning || isPreliminaryOutput)

  const isToolComplete =
    state === "output-available" && !preliminary && !isRunning

  useEffect(() => {
    if (!shouldTrackPending) return
    if (!conversationId || !normalizedFilePath || !toolCallId) return

    upsertPendingResource(conversationId, {
      toolCallId,
      path: normalizedFilePath,
      content: displayContent ?? "",
      isStreaming: isInputStreaming || isRunning || isPreliminaryOutput,
    })
  }, [
    conversationId,
    displayContent,
    isInputStreaming,
    isPreliminaryOutput,
    isRunning,
    normalizedFilePath,
    shouldTrackPending,
    toolCallId,
    upsertPendingResource,
  ])

  useEffect(() => {
    if (!isToolComplete) return
    if (!conversationId || !normalizedFilePath || !toolCallId) return
    if (!isConversationResourcePath(normalizedFilePath)) return

    upsertPendingResource(conversationId, {
      toolCallId,
      path: normalizedFilePath,
      content: displayContent ?? "",
      isStreaming: false,
    })

    void queryClient.invalidateQueries({
      queryKey: chatKeys.resources(String(conversationId)),
    })
  }, [
    conversationId,
    displayContent,
    isToolComplete,
    normalizedFilePath,
    queryClient,
    toolCallId,
    upsertPendingResource,
  ])

  useEffect(() => {
    if (!toolCallId || !conversationId) return
    if (shouldTrackPending || isToolComplete) return
    if (state !== "output-error") return

    clearPendingResource(conversationId, { toolCallId })
  }, [
    clearPendingResource,
    conversationId,
    isToolComplete,
    shouldTrackPending,
    state,
    toolCallId,
  ])
}

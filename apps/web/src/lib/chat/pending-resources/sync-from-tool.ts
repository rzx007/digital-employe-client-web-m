import { useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { chatKeys } from "@/lib/query-keys/chat"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"

import { isConversationResourcePath } from "./paths"

export interface SyncPendingResourceFromToolInput {
  toolName: string
  state: string
  preliminary?: boolean
  isRunning: boolean
  normalizedFilePath: string | null
  displayContent: string | null
}

export function useSyncPendingResourceFromTool({
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
    !!normalizedFilePath &&
    isConversationResourcePath(normalizedFilePath) &&
    (isInputStreaming || isRunning || isPreliminaryOutput)

  const isToolComplete =
    state === "output-available" && !preliminary && !isRunning

  useEffect(() => {
    if (!shouldTrackPending) return
    if (!conversationId || !normalizedFilePath) return

    upsertPendingResource(conversationId, {
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
    upsertPendingResource,
  ])

  useEffect(() => {
    if (!isToolComplete) return
    if (!conversationId || !normalizedFilePath) return
    if (!isConversationResourcePath(normalizedFilePath)) return

    upsertPendingResource(conversationId, {
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
    upsertPendingResource,
  ])

  useEffect(() => {
    if (!normalizedFilePath || !conversationId) return
    if (shouldTrackPending || isToolComplete) return
    if (state !== "output-error") return

    clearPendingResource(conversationId, normalizedFilePath)
  }, [
    clearPendingResource,
    conversationId,
    isToolComplete,
    normalizedFilePath,
    shouldTrackPending,
    state,
  ])
}

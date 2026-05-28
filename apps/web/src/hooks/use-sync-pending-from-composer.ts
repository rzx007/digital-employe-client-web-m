import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useArtifactStore } from "@/stores/artifact-store"
import { chatKeys } from "@/lib/query-keys/chat"
import { collectPendingToolSnapshots } from "@/lib/chat/pending-resources/sync-from-composer"
import type { UIMessage } from "ai"

export function useSyncPendingFromComposer(
  conversationId: string | number | null,
  composerMessages: UIMessage[],
  status: string
) {
  const upsertPendingResource = useArtifactStore((s) => s.upsertPendingResource)
  const clearPendingResource = useArtifactStore((s) => s.clearPendingResource)
  const queryClient = useQueryClient()
  
  const completedToolsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!conversationId) return

    const snapshots = collectPendingToolSnapshots(composerMessages)

    for (const snap of snapshots) {
      if (snap.isError) {
        clearPendingResource(conversationId, { toolCallId: snap.toolCallId })
        continue
      }

      if (snap.isToolComplete) {
        upsertPendingResource(conversationId, {
          toolCallId: snap.toolCallId,
          path: snap.normalizedFilePath,
          content: snap.displayContent,
          isStreaming: false,
        })
        
        if (!completedToolsRef.current.has(snap.toolCallId)) {
          completedToolsRef.current.add(snap.toolCallId)
          void queryClient.invalidateQueries({
            queryKey: chatKeys.resources(String(conversationId)),
          })
        }
      } else {
        upsertPendingResource(conversationId, {
          toolCallId: snap.toolCallId,
          path: snap.normalizedFilePath,
          content: snap.displayContent,
          isStreaming: snap.isStreaming,
        })
      }
    }
  }, [
    conversationId,
    composerMessages,
    status,
    upsertPendingResource,
    clearPendingResource,
    queryClient,
  ])
}

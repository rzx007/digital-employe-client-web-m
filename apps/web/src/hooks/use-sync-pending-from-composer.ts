import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useArtifactStore } from "@/stores/artifact-store"
import { chatKeys } from "@/lib/query-keys/chat"
import {
  collectPendingToolSnapshots,
  type PendingToolSnapshot,
} from "@/lib/chat/pending-resources/sync-from-composer"
import type { UIMessage } from "ai"

const STREAMING_FLUSH_MS = 400

type TrackedSnapshot = {
  path: string
  content: string
  isStreaming: boolean
}

function shouldFlushImmediately(
  prev: TrackedSnapshot | undefined,
  snap: PendingToolSnapshot
): boolean {
  if (!prev) return true
  if (prev.path !== snap.normalizedFilePath) return true
  if (prev.isStreaming !== snap.isStreaming) return true
  if (snap.isToolComplete || snap.isError) return true
  return false
}

export function useSyncPendingFromComposer(
  conversationId: string | number | null,
  composerMessages: UIMessage[],
  status: string
) {
  const upsertPendingResource = useArtifactStore((s) => s.upsertPendingResource)
  const clearPendingResource = useArtifactStore((s) => s.clearPendingResource)
  const queryClient = useQueryClient()

  const completedToolsRef = useRef<Set<string>>(new Set())
  const lastFlushedRef = useRef<Map<string, TrackedSnapshot>>(new Map())
  const pendingStreamingRef = useRef<Map<string, PendingToolSnapshot>>(new Map())
  const flushTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  useEffect(() => {
    if (!conversationId) return

    const convKey = String(conversationId)
    const snapshots = collectPendingToolSnapshots(composerMessages)
    const activeToolCallIds = new Set(snapshots.map((s) => s.toolCallId))

    const flushSnapshot = (snap: PendingToolSnapshot) => {
      if (snap.isError) {
        clearPendingResource(conversationId, { toolCallId: snap.toolCallId })
        lastFlushedRef.current.delete(snap.toolCallId)
        pendingStreamingRef.current.delete(snap.toolCallId)
        return
      }

      upsertPendingResource(conversationId, {
        toolCallId: snap.toolCallId,
        path: snap.normalizedFilePath,
        content: snap.displayContent,
        isStreaming: snap.isToolComplete ? false : snap.isStreaming,
      })

      lastFlushedRef.current.set(snap.toolCallId, {
        path: snap.normalizedFilePath,
        content: snap.displayContent,
        isStreaming: snap.isToolComplete ? false : snap.isStreaming,
      })

      if (snap.isToolComplete) {
        if (!completedToolsRef.current.has(snap.toolCallId)) {
          completedToolsRef.current.add(snap.toolCallId)
          void queryClient.invalidateQueries({
            queryKey: chatKeys.resources(convKey),
          })
        }
        pendingStreamingRef.current.delete(snap.toolCallId)
      }
    }

    const scheduleStreamingFlush = (snap: PendingToolSnapshot) => {
      pendingStreamingRef.current.set(snap.toolCallId, snap)
      const existingTimer = flushTimersRef.current.get(snap.toolCallId)
      if (existingTimer) return

      const timer = setTimeout(() => {
        flushTimersRef.current.delete(snap.toolCallId)
        const latest = pendingStreamingRef.current.get(snap.toolCallId)
        if (latest) flushSnapshot(latest)
      }, STREAMING_FLUSH_MS)
      flushTimersRef.current.set(snap.toolCallId, timer)
    }

    for (const snap of snapshots) {
      if (snap.isError) {
        const timer = flushTimersRef.current.get(snap.toolCallId)
        if (timer) {
          clearTimeout(timer)
          flushTimersRef.current.delete(snap.toolCallId)
        }
        flushSnapshot(snap)
        continue
      }

      if (snap.isToolComplete) {
        const timer = flushTimersRef.current.get(snap.toolCallId)
        if (timer) {
          clearTimeout(timer)
          flushTimersRef.current.delete(snap.toolCallId)
        }
        flushSnapshot(snap)
        continue
      }

      const prev = lastFlushedRef.current.get(snap.toolCallId)
      if (shouldFlushImmediately(prev, snap)) {
        const timer = flushTimersRef.current.get(snap.toolCallId)
        if (timer) {
          clearTimeout(timer)
          flushTimersRef.current.delete(snap.toolCallId)
        }
        flushSnapshot(snap)
        continue
      }

      scheduleStreamingFlush(snap)
    }

    for (const toolCallId of lastFlushedRef.current.keys()) {
      if (!activeToolCallIds.has(toolCallId)) {
        lastFlushedRef.current.delete(toolCallId)
        pendingStreamingRef.current.delete(toolCallId)
        const timer = flushTimersRef.current.get(toolCallId)
        if (timer) {
          clearTimeout(timer)
          flushTimersRef.current.delete(toolCallId)
        }
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

  useEffect(() => {
    const flushTimers = flushTimersRef.current
    return () => {
      for (const timer of flushTimers.values()) {
        clearTimeout(timer)
      }
      flushTimers.clear()
    }
  }, [conversationId])
}

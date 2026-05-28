import { useCallback, useEffect, useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import type { ResourceEntry, ResourceList } from "@/api/types"
import { useArtifactStore } from "@/stores/artifact-store"

import {
  findEntryByPath,
  findPendingByPath,
  flattenResourceListEntries,
  mergePendingIntoResourceList,
  resolveResourceEntryWithPending,
} from "./merge"
import type { PendingResource } from "./types"

const EMPTY_PENDING_LIST: PendingResource[] = []

const EMPTY_RESOURCE_LIST: ResourceList = {
  artifacts: [],
  uploads: [],
  skills_draft: [],
}

export function useConversationPendingResources(
  conversationId: string | number | null,
  apiResourceList: ResourceList | undefined
) {
  const clearPendingResource = useArtifactStore((s) => s.clearPendingResource)
  const pendingList = useArtifactStore(
    useShallow((s) => {
      if (!conversationId) return EMPTY_PENDING_LIST
      const map = s.pendingByConversation.get(String(conversationId))
      return map ? Array.from(map.values()) : EMPTY_PENDING_LIST
    })
  )

  const apiResources = apiResourceList ?? EMPTY_RESOURCE_LIST
  const mergedResources = useMemo(
    () => mergePendingIntoResourceList(apiResources, pendingList),
    [apiResources, pendingList]
  )

  useEffect(() => {
    if (!conversationId || !apiResourceList) return
    for (const pending of pendingList) {
      const existsOnDisk = findEntryByPath(
        flattenResourceListEntries(apiResourceList),
        pending.path
      )
      if (existsOnDisk) {
        clearPendingResource(conversationId, pending.path)
      }
    }
  }, [apiResourceList, clearPendingResource, conversationId, pendingList])

  const getPendingForPath = useCallback(
    (path: string) => findPendingByPath(pendingList, path),
    [pendingList]
  )

  const resolveEntryForPath = useCallback(
    (selectedPath: string | null): ResourceEntry | null =>
      resolveResourceEntryWithPending(
        selectedPath,
        mergedResources,
        pendingList
      ),
    [mergedResources, pendingList]
  )

  return {
    pendingList,
    mergedResources,
    getPendingForPath,
    resolveEntryForPath,
  }
}

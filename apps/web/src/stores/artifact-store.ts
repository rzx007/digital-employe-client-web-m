import { create } from "zustand"
import type { Artifact } from "@/types/artifact"
import type {
  PendingResource,
  UpsertPendingResourceInput,
} from "@/lib/chat/pending-resources"

import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"

export type { PendingResource, UpsertPendingResourceInput }

function closeOtherSidePanels() {
  useMonitorStore.getState().closeMonitor()
  useChatStore.getState().closeConversationList()
}

interface ArtifactStore {
  activeArtifactId: string | null
  activeResourcePath: string | null
  isPanelOpen: boolean
  artifacts: Map<string, Artifact>
  pendingByConversation: Map<string, Map<string, PendingResource>>

  openArtifact: (id: string) => void
  openResource: (path: string) => void
  closeArtifact: () => void
  addArtifact: (artifact: Artifact) => void
  removeArtifact: (id: string) => void
  setPanelOpen: (open: boolean) => void
  updateArtifactContent: (id: string, content: string) => void
  upsertPendingResource: (
    conversationId: string | number,
    input: UpsertPendingResourceInput
  ) => void
  clearPendingResource: (
    conversationId: string | number,
    path: string
  ) => void
  clearPendingConversation: (conversationId: string | number) => void
  getPendingResources: (conversationId: string | number) => PendingResource[]
}

function toConversationKey(conversationId: string | number) {
  return String(conversationId)
}

export const useArtifactStore = create<ArtifactStore>((set, get) => ({
  activeArtifactId: null,
  activeResourcePath: null,
  isPanelOpen: false,
  artifacts: new Map(),
  pendingByConversation: new Map(),

  openArtifact: (id) => {
    closeOtherSidePanels()
    set({ activeArtifactId: id, activeResourcePath: null, isPanelOpen: true })
  },
  openResource: (path) => {
    closeOtherSidePanels()
    set({ activeArtifactId: null, activeResourcePath: path, isPanelOpen: true })
  },
  closeArtifact: () =>
    set({
      activeArtifactId: null,
      activeResourcePath: null,
      isPanelOpen: false,
    }),
  addArtifact: (artifact) =>
    set((state) => {
      const artifacts = new Map(state.artifacts)
      artifacts.set(artifact.id, artifact)
      return { artifacts }
    }),
  removeArtifact: (id) =>
    set((state) => {
      const artifacts = new Map(state.artifacts)
      artifacts.delete(id)
      if (state.activeArtifactId === id) {
        return {
          activeArtifactId: null,
          activeResourcePath: null,
          isPanelOpen: false,
          artifacts,
        }
      }
      return { artifacts }
    }),
  setPanelOpen: (open) => {
    if (open) closeOtherSidePanels()
    set({
      isPanelOpen: open,
      ...(open ? {} : { activeResourcePath: null }),
    })
  },
  updateArtifactContent: (id, content) =>
    set((state) => {
      const artifacts = new Map(state.artifacts)
      const existing = artifacts.get(id)
      if (existing) {
        artifacts.set(id, { ...existing, content })
        return { artifacts }
      }
      return state
    }),
  upsertPendingResource: (conversationId, input) =>
    set((state) => {
      const key = toConversationKey(conversationId)
      const pendingByConversation = new Map(state.pendingByConversation)
      const existingMap = pendingByConversation.get(key) ?? new Map()
      const nextMap = new Map(existingMap)
      nextMap.set(input.path, {
        path: input.path,
        content: input.content,
        isStreaming: input.isStreaming,
        updatedAt: Date.now(),
      })
      pendingByConversation.set(key, nextMap)
      return { pendingByConversation }
    }),
  clearPendingResource: (conversationId, path) =>
    set((state) => {
      const key = toConversationKey(conversationId)
      const existingMap = state.pendingByConversation.get(key)
      if (!existingMap?.has(path)) return state
      const pendingByConversation = new Map(state.pendingByConversation)
      const nextMap = new Map(existingMap)
      nextMap.delete(path)
      if (nextMap.size === 0) {
        pendingByConversation.delete(key)
      } else {
        pendingByConversation.set(key, nextMap)
      }
      return { pendingByConversation }
    }),
  clearPendingConversation: (conversationId) =>
    set((state) => {
      const key = toConversationKey(conversationId)
      if (!state.pendingByConversation.has(key)) return state
      const pendingByConversation = new Map(state.pendingByConversation)
      pendingByConversation.delete(key)
      return { pendingByConversation }
    }),
  getPendingResources: (conversationId) => {
    const map = get().pendingByConversation.get(toConversationKey(conversationId))
    return map ? Array.from(map.values()) : []
  },
}))

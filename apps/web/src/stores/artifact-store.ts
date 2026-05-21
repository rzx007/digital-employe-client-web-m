import { create } from "zustand"
import type { Artifact } from "@/types/artifact"

import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"

function closeOtherSidePanels() {
  useMonitorStore.getState().closeMonitor()
  useChatStore.getState().closeConversationList()
}

interface ArtifactStore {
  activeArtifactId: string | null
  activeResourcePath: string | null
  isPanelOpen: boolean
  artifacts: Map<string, Artifact>

  openArtifact: (id: string) => void
  openResource: (path: string) => void
  closeArtifact: () => void
  addArtifact: (artifact: Artifact) => void
  removeArtifact: (id: string) => void
  setPanelOpen: (open: boolean) => void
  updateArtifactContent: (id: string, content: string) => void
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  activeArtifactId: null,
  activeResourcePath: null,
  isPanelOpen: false,
  artifacts: new Map(),

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
}))

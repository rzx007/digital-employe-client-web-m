import { create } from "zustand"
import type { Artifact } from "@/types/artifact"

interface ArtifactStore {
  activeArtifactId: string | null
  isPanelOpen: boolean
  isFullscreen: boolean
  artifacts: Map<string, Artifact>

  openArtifact: (id: string) => void
  closeArtifact: () => void
  addArtifact: (artifact: Artifact) => void
  removeArtifact: (id: string) => void
  toggleFullscreen: () => void
  setFullscreen: (fullscreen: boolean) => void
  setPanelOpen: (open: boolean) => void
}

export const useArtifactStore = create<ArtifactStore>((set) => ({
  activeArtifactId: null,
  isPanelOpen: false,
  isFullscreen: false,
  artifacts: new Map(),

  openArtifact: (id) => set({ activeArtifactId: id, isPanelOpen: true }),
  closeArtifact: () =>
    set({ activeArtifactId: null, isPanelOpen: false, isFullscreen: false }),
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
        return { activeArtifactId: null, isPanelOpen: false, artifacts }
      }
      return { artifacts }
    }),
  toggleFullscreen: () =>
    set((state) => ({ isFullscreen: !state.isFullscreen })),
  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setPanelOpen: (open) => set({ isPanelOpen: open }),
}))

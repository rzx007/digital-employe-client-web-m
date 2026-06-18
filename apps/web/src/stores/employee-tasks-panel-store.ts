import { create } from "zustand"

import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"

function closeOtherSidePanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useSubtaskPanelStore.getState().close()
  useBrowserStore.getState().minimizeBrowser()
}

interface EmployeeTasksPanelStore {
  isOpen: boolean

  open: () => void
  close: () => void
  toggle: () => void
}

export const useEmployeeTasksPanelStore = create<EmployeeTasksPanelStore>(
  (set, get) => ({
    isOpen: false,

    open: () => {
      closeOtherSidePanels()
      set({ isOpen: true })
    },
    close: () => set({ isOpen: false }),
    toggle: () => {
      const next = !get().isOpen
      if (next) closeOtherSidePanels()
      set({ isOpen: next })
    },
  })
)

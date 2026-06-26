import { create } from "zustand"

import { useArtifactStore } from "@/stores/artifact-store"
import { useBrowserStore } from "@/stores/browser-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"

function closeOtherSidePanels() {
  useArtifactStore.getState().closeArtifact()
  useMonitorStore.getState().closeMonitor()
  useSubtaskPanelStore.getState().close()
  useEmployeeTasksPanelStore.getState().close()
  useBrowserStore.getState().minimizeBrowser()
}

interface ShellTasksPanelStore {
  isOpen: boolean

  open: () => void
  close: () => void
  toggle: () => void
}

export const useShellTasksPanelStore = create<ShellTasksPanelStore>(
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

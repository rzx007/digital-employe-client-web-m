import { create } from "zustand"

import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"

interface MonitorStore {
  isOpen: boolean
  targetEmployeeId: string | null
  targetEmployeeName: string

  openMonitor: (employeeId: string, employeeName: string) => void
  setTargetEmployee: (employeeId: string, employeeName: string) => void
  closeMonitor: () => void
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  isOpen: false,
  targetEmployeeId: null,
  targetEmployeeName: "",

  openMonitor: (employeeId, employeeName) => {
    useArtifactStore.getState().closeArtifact()
    useSubtaskPanelStore.getState().close()
    useEmployeeTasksPanelStore.getState().close()
    useChatStore.getState().setActiveTab("chat")
    set({
      isOpen: true,
      targetEmployeeId: employeeId,
      targetEmployeeName: employeeName,
    })
  },

  setTargetEmployee: (employeeId, employeeName) =>
    set({
      targetEmployeeId: employeeId,
      targetEmployeeName: employeeName,
    }),

  closeMonitor: () =>
    set({
      isOpen: false,
      targetEmployeeId: null,
      targetEmployeeName: "",
    }),
}))

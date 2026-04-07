import { create } from "zustand"

interface MonitorStore {
  isOpen: boolean
  isFullscreen: boolean
  targetEmployeeId: string | null
  targetEmployeeName: string

  openMonitor: (employeeId: string, employeeName: string) => void
  setTargetEmployee: (employeeId: string, employeeName: string) => void
  closeMonitor: () => void
  toggleFullscreen: () => void
  setFullscreen: (fullscreen: boolean) => void
}

export const useMonitorStore = create<MonitorStore>((set) => ({
  isOpen: false,
  isFullscreen: false,
  targetEmployeeId: null,
  targetEmployeeName: "",

  openMonitor: (employeeId, employeeName) =>
    set({
      isOpen: true,
      isFullscreen: false,
      targetEmployeeId: employeeId,
      targetEmployeeName: employeeName,
    }),

  setTargetEmployee: (employeeId, employeeName) =>
    set({
      targetEmployeeId: employeeId,
      targetEmployeeName: employeeName,
    }),

  closeMonitor: () =>
    set({
      isOpen: false,
      isFullscreen: false,
      targetEmployeeId: null,
      targetEmployeeName: "",
    }),

  toggleFullscreen: () =>
    set((state) => ({ isFullscreen: !state.isFullscreen })),

  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
}))

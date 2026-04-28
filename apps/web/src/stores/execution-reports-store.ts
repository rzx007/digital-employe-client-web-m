import { create } from "zustand"

export interface ExecutionReport {
  taskId: number
  conversationId: number
  employeeId: number
  employeeName: string
  taskName: string
  status: "success" | "failed"
  ts: number
  outputText?: string
}

export interface ExecutionReportsStore {
  reports: ExecutionReport[]
  pushReport: (report: ExecutionReport) => void
  clearReports: () => void
}

export const useExecutionReportsStore = create<ExecutionReportsStore>((set) => ({
  reports: [],
  pushReport: (report) =>
    set((state) => ({
      reports: [...state.reports, report],
    })),
  clearReports: () => set({ reports: [] }),
}))

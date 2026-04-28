import { create } from "zustand"

export interface OrchestrationTaskProgress {
  task_id: number
  employee_name: string
  task_name: string
  status: "pending" | "running" | "success" | "failed"
  conversation_id?: number
  cron?: string | null
  execute_mode: string
}

export interface PlanProgress {
  planId: number
  summary: string
  total: number
  completed: number
  tasks: OrchestrationTaskProgress[]
}

export interface PendingPlan {
  planId: number
  summary: string
  tasks: OrchestrationTaskProgress[]
}

interface OrchestrationStore {
  pendingPlan: PendingPlan | null
  activePlans: Record<number, PlanProgress>
  setPendingPlan: (plan: PendingPlan) => void
  clearPendingPlan: () => void
  updateTaskProgress: (planId: number, taskId: number, status: OrchestrationTaskProgress["status"], conversationId?: number) => void
  setPlanTasks: (planId: number, summary: string, tasks: OrchestrationTaskProgress[]) => void
}

export const useOrchestrationStore = create<OrchestrationStore>((set) => ({
  pendingPlan: null,
  activePlans: {},

  setPendingPlan: (plan) => set({ pendingPlan: plan }),

  clearPendingPlan: () => set({ pendingPlan: null }),

  setPlanTasks: (planId, summary, tasks) =>
    set((state) => ({
      activePlans: {
        ...state.activePlans,
        [planId]: {
          planId,
          summary,
          total: tasks.length,
          completed: tasks.filter((t) => t.status === "success").length,
          tasks,
        },
      },
    })),

  updateTaskProgress: (planId, taskId, status, conversationId) =>
    set((state) => {
      const plan = state.activePlans[planId]
      if (!plan) return state

      const tasks = plan.tasks.map((t) =>
        t.task_id === taskId
          ? { ...t, status, conversation_id: conversationId ?? t.conversation_id }
          : t
      )

      return {
        activePlans: {
          ...state.activePlans,
          [planId]: {
            ...plan,
            tasks,
            completed: tasks.filter((t) => t.status === "success").length,
          },
        },
      }
    }),
}))

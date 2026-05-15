import { create } from "zustand"

interface ConversationStatusStore {
  statuses: Record<number, string>
  counts: Record<string, number>
  _convToContact: Record<number, string>

  setStatus: (
    conversationId: number,
    status: string,
    targetType?: string,
    targetId?: number,
  ) => void
  resetStatus: (conversationId: number) => void
}

export const useConversationStatusStore = create<ConversationStatusStore>(
  (set) => ({
    statuses: {},
    counts: {},
    _convToContact: {},

    setStatus: (conversationId, status, targetType?, targetId?) =>
      set((state) => {
        const newStatuses = { ...state.statuses }
        const prevStatus = newStatuses[conversationId]
        const isRunning = status === "running"
        const wasRunning = prevStatus === "running"

        if (status === "idle") {
          delete newStatuses[conversationId]
        } else {
          newStatuses[conversationId] = status
        }

        if (targetType != null && targetId != null) {
          const key = `${targetType}:${targetId}`
          const newCounts = { ...state.counts }
          const newConvToContact = { ...state._convToContact }

          if (isRunning && !wasRunning) {
            newCounts[key] = (newCounts[key] ?? 0) + 1
            newConvToContact[conversationId] = key
          } else if (!isRunning && wasRunning) {
            newCounts[key] = Math.max(0, (newCounts[key] ?? 1) - 1)
            delete newConvToContact[conversationId]
          }

          return {
            statuses: newStatuses,
            counts: newCounts,
            _convToContact: newConvToContact,
          }
        }

        return { statuses: newStatuses }
      }),

    resetStatus: (conversationId) =>
      set((state) => {
        const newStatuses = { ...state.statuses }
        delete newStatuses[conversationId]
        const newConvToContact = { ...state._convToContact }
        const contactKey = newConvToContact[conversationId]
        delete newConvToContact[conversationId]
        if (contactKey) {
          const newCounts = { ...state.counts }
          newCounts[contactKey] = Math.max(
            0,
            (newCounts[contactKey] ?? 1) - 1,
          )
          return {
            statuses: newStatuses,
            _convToContact: newConvToContact,
            counts: newCounts,
          }
        }
        return {
          statuses: newStatuses,
          _convToContact: newConvToContact,
        }
      }),
  }),
)

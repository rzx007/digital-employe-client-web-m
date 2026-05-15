import { create } from "zustand"

import { useChatStore } from "@/stores/chat-store"

interface ConversationStatusStore {
  statuses: Record<number, string>
  unreadCounts: Record<string, number>
  _convToContact: Record<number, string>

  setStatus: (
    conversationId: number,
    status: string,
    targetType?: string,
    targetId?: number,
  ) => void
  markAsRead: (conversationId: number) => void
}

export const useConversationStatusStore = create<ConversationStatusStore>(
  (set) => ({
    statuses: {},
    unreadCounts: {},
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
          const newConvToContact = { ...state._convToContact }
          const newUnreadCounts = { ...state.unreadCounts }

          if (isRunning && !wasRunning) {
            newConvToContact[conversationId] = key
            newUnreadCounts[key] = (newUnreadCounts[key] ?? 0) + 1
          }

          if (!isRunning && wasRunning) {
            newConvToContact[conversationId] = key
            const selectedConvId =
              useChatStore.getState().selectedConversationId
            if (Number(selectedConvId) === conversationId) {
              newUnreadCounts[key] = Math.max(
                0,
                (newUnreadCounts[key] ?? 1) - 1,
              )
            }
          }

          return {
            statuses: newStatuses,
            unreadCounts: newUnreadCounts,
            _convToContact: newConvToContact,
          }
        }

        return { statuses: newStatuses }
      }),

    markAsRead: (conversationId) =>
      set((state) => {
        const contactKey = state._convToContact[conversationId]
        if (!contactKey) return state
        const currentCount = state.unreadCounts[contactKey] ?? 0
        if (currentCount <= 0) return state
        return {
          unreadCounts: {
            ...state.unreadCounts,
            [contactKey]: currentCount - 1,
          },
        }
      }),
  }),
)

useChatStore.subscribe((state, prevState) => {
  if (state.selectedConversationId !== prevState.selectedConversationId) {
    const convId = Number(state.selectedConversationId)
    if (!isNaN(convId)) {
      useConversationStatusStore.getState().markAsRead(convId)
    }
  }
})

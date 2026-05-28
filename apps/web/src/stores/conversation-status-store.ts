import { create } from "zustand"

import { curatorUnreadKey } from "@/lib/constants"
import { useChatStore } from "@/stores/chat-store"

function isViewingCurator(): boolean {
  return useChatStore.getState().getSelectedContact()?.type === "curator"
}

function getSelectedCuratorUnreadKey(): string | null {
  const contact = useChatStore.getState().getSelectedContact()
  if (contact?.type !== "curator" || !contact.curator?.id) return null
  return curatorUnreadKey(contact.curator.id)
}

interface ConversationStatusStore {
  statuses: Record<number, string>
  unreadCounts: Record<string, number>
  _convToContact: Record<number, string>

  setStatus: (
    conversationId: number,
    status: string,
    targetType?: string,
    targetId?: number
  ) => void
  markAsRead: (conversationId: number) => void
  clearUnreadByContactKey: (key: string) => void
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
            const viewingConv = Number(selectedConvId) === conversationId
            const selectedCuratorKey = getSelectedCuratorUnreadKey()
            const viewingCurator =
              targetType === "curator" &&
              isViewingCurator() &&
              selectedCuratorKey != null &&
              key === selectedCuratorKey
            if (viewingConv || viewingCurator) {
              newUnreadCounts[key] = Math.max(
                0,
                (newUnreadCounts[key] ?? 1) - 1
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

    clearUnreadByContactKey: (key) =>
      set((state) => {
        if ((state.unreadCounts[key] ?? 0) === 0) return state
        return {
          unreadCounts: {
            ...state.unreadCounts,
            [key]: 0,
          },
        }
      }),
  })
)

function clearSelectedCuratorUnread(): void {
  const key = getSelectedCuratorUnreadKey()
  if (key) {
    useConversationStatusStore.getState().clearUnreadByContactKey(key)
  }
}

useChatStore.subscribe((state, prevState) => {
  if (state.selectedConversationId !== prevState.selectedConversationId) {
    const convId = Number(state.selectedConversationId)
    if (!isNaN(convId)) {
      useConversationStatusStore.getState().markAsRead(convId)
    }
  }

  if (state.selectedContactId !== prevState.selectedContactId) {
    if (state.getSelectedContact()?.type === "curator") {
      clearSelectedCuratorUnread()
    }
  }
})

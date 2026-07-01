import { create } from "zustand"
import { persist } from "zustand/middleware"

export interface ScheduledRunNotification {
  run_id: number
  title: string
  run_seq: number
  conversation_id: number
  ts: number
  read: boolean
}

interface NotificationStore {
  dialogOpen: boolean
  autoPopupDisabled: boolean
  items: ScheduledRunNotification[]
  setDialogOpen: (open: boolean) => void
  setAutoPopupDisabled: (disabled: boolean) => void
  push: (item: ScheduledRunNotification) => void
  markRead: (run_id: number) => void
  markAllRead: () => void
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      dialogOpen: false,
      autoPopupDisabled: false,
      items: [],
      setDialogOpen: (open) => set({ dialogOpen: open }),
      setAutoPopupDisabled: (disabled) => set({ autoPopupDisabled: disabled }),
      push: (item) =>
        set((state) => {
          if (state.items.some((i) => i.run_id === item.run_id)) return state
          return { items: [item, ...state.items] }
        }),
      markRead: (run_id) =>
        set((state) => ({
          items: state.items.map((i) =>
            i.run_id === run_id ? { ...i, read: true } : i
          ),
        })),
      markAllRead: () =>
        set((state) => ({
          items: state.items.map((i) => ({ ...i, read: true })),
        })),
    }),
    {
      name: "notification-settings",
      partialize: (state) => ({ autoPopupDisabled: state.autoPopupDisabled }),
    }
  )
)

export function selectUnreadCount(state: NotificationStore): number {
  return state.items.filter((i) => !i.read).length
}

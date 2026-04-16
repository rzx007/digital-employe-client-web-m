import { create } from "zustand"
import { persist } from "zustand/middleware"

interface NotificationStore {
  dialogOpen: boolean
  autoPopupDisabled: boolean
  setDialogOpen: (open: boolean) => void
  setAutoPopupDisabled: (disabled: boolean) => void
}

export const useNotificationStore = create<NotificationStore>()(
  persist(
    (set) => ({
      dialogOpen: false,
      autoPopupDisabled: false,
      setDialogOpen: (open) => set({ dialogOpen: open }),
      setAutoPopupDisabled: (disabled) => set({ autoPopupDisabled: disabled }),
    }),
    {
      name: "notification-settings",
      partialize: (state) => ({ autoPopupDisabled: state.autoPopupDisabled }),
    }
  )
)

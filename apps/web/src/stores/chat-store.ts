import { create } from "zustand"
import { persist } from "zustand/middleware"

import {
  DEFAULT_SELECTED_CONTACT_ID,
  findContactInList,
  type Contact,
} from "@/lib/mock-data/ai-employees"

export type ActiveTab = "chat" | "contacts" | "calendar"

interface ChatStore {
  contacts: Contact[]
  selectedContactId: string | null
  selectedConversationId: string | number | null
  isDraftConversation: boolean
  draftSessionKey: number
  showWorkbench: boolean
  activeTab: ActiveTab
  setContacts: (contacts: Contact[]) => void
  setSelectedContactId: (id: string | null) => void
  setSelectedConversationId: (id: string | number | null) => void
  setDraftConversation: (isDraft: boolean) => void
  setShowWorkbench: (show: boolean) => void
  setActiveTab: (tab: ActiveTab) => void
  startDraftConversation: (contactId: string) => void
  selectConversation: (contactId: string, conversationId: string) => void
  switchToContact: (contactId: string) => void
  getSelectedContact: () => Contact | undefined
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      contacts: [],
      selectedContactId: DEFAULT_SELECTED_CONTACT_ID,
      selectedConversationId: null,
      isDraftConversation: false,
      draftSessionKey: 0,
      showWorkbench: false,
      activeTab: "chat" as ActiveTab,
      setContacts: (contacts) => set({ contacts }),
      setSelectedContactId: (id) =>
        set({
          selectedContactId: id,
          selectedConversationId: null,
          isDraftConversation: false,
          draftSessionKey: 0,
        }),
      setSelectedConversationId: (id) =>
        set({
          selectedConversationId: id,
        }),
      setDraftConversation: (isDraft) =>
        set((state) => ({
          isDraftConversation: isDraft,
          selectedConversationId: isDraft ? null : state.selectedConversationId,
          draftSessionKey: isDraft
            ? state.draftSessionKey + 1
            : state.draftSessionKey,
        })),
      setShowWorkbench: (show) => set({ showWorkbench: show }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      startDraftConversation: (contactId) =>
        set((state) => ({
          selectedContactId: contactId,
          selectedConversationId: null,
          isDraftConversation: true,
          draftSessionKey: state.draftSessionKey + 1,
          activeTab: "chat" as ActiveTab,
        })),
      selectConversation: (contactId, conversationId) =>
        set({
          selectedContactId: contactId,
          selectedConversationId: conversationId,
          isDraftConversation: false,
        }),
      switchToContact: (contactId) =>
        set((state) => ({
          selectedContactId: contactId,
          selectedConversationId: null,
          isDraftConversation: false,
          draftSessionKey: state.draftSessionKey + 1,
          activeTab: "chat" as ActiveTab,
        })),
      getSelectedContact: () => {
        const { contacts, selectedContactId } = get()
        if (!selectedContactId) return undefined
        return findContactInList(contacts, selectedContactId)
      },
    }),
    {
      name: "chat:selection",
      partialize: (state) => ({
        selectedContactId: state.selectedContactId,
        selectedConversationId: state.selectedConversationId,
      }),
    }
  )
)

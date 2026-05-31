import { create } from "zustand"
import { persist } from "zustand/middleware"

import { findContactInList } from "@/lib/chat/contact-utils"
import type { CuratorNavigationReturn } from "@/lib/chat/curator-navigation"
import type { Contact } from "@/types/chat"
import { useArtifactStore } from "@/stores/artifact-store"
import { useMonitorStore } from "@/stores/monitor-store"

export type ActiveTab =
  | "chat"
  | "contacts"
  | "calendar"
  | "workbench"
  | "skills"

interface ChatStore {
  contacts: Contact[]
  selectedContactId: string | null
  selectedConversationId: string | number | null
  /** 工作台右侧总管面板独立会话，不随聊天 Tab 切换员工而变 */
  workbenchCuratorConversationId: string | number | null
  isDraftConversation: boolean
  draftSessionKey: number
  showWorkbench: boolean
  activeTab: ActiveTab
  isCompactMode: boolean
  isConversationListOpen: boolean
  /** 从总管/工作台跳转到员工对话后，用于「返回总管」 */
  curatorNavigationReturn: CuratorNavigationReturn | null
  setContacts: (contacts: Contact[]) => void
  setSelectedContactId: (id: string | null) => void
  setSelectedConversationId: (id: string | number | null) => void
  setWorkbenchCuratorConversationId: (id: string | number | null) => void
  setDraftConversation: (isDraft: boolean) => void
  setShowWorkbench: (show: boolean) => void
  setActiveTab: (tab: ActiveTab) => void
  setCompactMode: (compact: boolean) => void
  openConversationList: () => void
  closeConversationList: () => void
  setCuratorNavigationReturn: (ctx: CuratorNavigationReturn | null) => void
  clearCuratorNavigationReturn: () => void
  startDraftConversation: (contactId: string) => void
  selectConversation: (contactId: string, conversationId: string) => void
  switchToContact: (contactId: string) => void
  getSelectedContact: () => Contact | undefined
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      contacts: [],
      selectedContactId: null,
      selectedConversationId: null,
      workbenchCuratorConversationId: null,
      isDraftConversation: false,
      draftSessionKey: 0,
      showWorkbench: false,
      activeTab: "chat" as ActiveTab,
      isCompactMode: false,
      isConversationListOpen: false,
      curatorNavigationReturn: null,
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
      setWorkbenchCuratorConversationId: (id) =>
        set({
          workbenchCuratorConversationId: id,
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
      setCompactMode: (compact) => set({ isCompactMode: compact }),
      openConversationList: () => {
        useArtifactStore.getState().closeArtifact()
        useMonitorStore.getState().closeMonitor()
        set({ isConversationListOpen: true, activeTab: "chat" as ActiveTab })
      },
      closeConversationList: () => set({ isConversationListOpen: false }),
      setCuratorNavigationReturn: (ctx) =>
        set({ curatorNavigationReturn: ctx }),
      clearCuratorNavigationReturn: () =>
        set({ curatorNavigationReturn: null }),
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
        workbenchCuratorConversationId: state.workbenchCuratorConversationId,
        activeTab: state.activeTab,
      }),
    }
  )
)

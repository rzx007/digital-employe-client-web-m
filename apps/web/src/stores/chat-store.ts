import { create } from "zustand"
import { persist } from "zustand/middleware"

import {
  findContactInList,
  getContactId,
} from "@/lib/chat/contact-utils"
import type { CuratorNavigationReturn } from "@/lib/chat/curator-navigation"
import type { Contact } from "@/types/chat"

export type ActiveTab =
  | "chat"
  | "contacts"
  | "calendar"
  | "workbench"
  | "skills"

function isEmployeeContactId(id: string | null | undefined): boolean {
  return id?.startsWith("employee:") ?? false
}

function findCuratorContactId(contacts: readonly Contact[]): string | null {
  const curator = contacts.find((c) => c.type === "curator")
  return curator ? getContactId(curator) : null
}

interface ChatStore {
  contacts: Contact[]
  /** 对话 Tab 当前聊天联系人（总管或深链临时员工） */
  selectedContactId: string | null
  /** 联系人 Tab 右侧详情面板选中联系人 */
  detailContactId: string | null
  selectedConversationId: string | number | null
  /** 工作台右侧总管面板独立会话，不随聊天 Tab 切换员工而变 */
  workbenchCuratorConversationId: string | number | null
  isDraftConversation: boolean
  draftSessionKey: number
  showWorkbench: boolean
  activeTab: ActiveTab
  isCompactMode: boolean
  /** 从总管/工作台跳转到员工对话后，用于「返回总管」 */
  curatorNavigationReturn: CuratorNavigationReturn | null
  setContacts: (contacts: Contact[]) => void
  setSelectedContactId: (id: string | null) => void
  setDetailContactId: (id: string | null) => void
  setSelectedConversationId: (id: string | number | null) => void
  setWorkbenchCuratorConversationId: (id: string | number | null) => void
  setDraftConversation: (isDraft: boolean) => void
  setShowWorkbench: (show: boolean) => void
  setActiveTab: (tab: ActiveTab) => void
  setCompactMode: (compact: boolean) => void
  setCuratorNavigationReturn: (ctx: CuratorNavigationReturn | null) => void
  clearCuratorNavigationReturn: () => void
  startDraftConversation: (contactId: string) => void
  selectConversation: (contactId: string, conversationId: string) => void
  switchToContact: (contactId: string) => void
  getSelectedContact: () => Contact | undefined
  getDetailContact: () => Contact | undefined
  getCuratorContact: () => Contact | undefined
  /** 非深链时把对话 Tab 选中归位到总管（保留 selectedConversationId） */
  resetToCuratorContact: () => void
  /** 兼容旧 persist：员工 selectedContactId 迁到 detailContactId 并归位总管 */
  migrateLegacyEmployeeSelection: () => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      contacts: [],
      selectedContactId: null,
      detailContactId: null,
      selectedConversationId: null,
      workbenchCuratorConversationId: null,
      isDraftConversation: false,
      draftSessionKey: 0,
      showWorkbench: false,
      activeTab: "chat" as ActiveTab,
      isCompactMode: false,
      curatorNavigationReturn: null,
      setContacts: (contacts) => set({ contacts }),
      setSelectedContactId: (id) =>
        set({
          selectedContactId: id,
          selectedConversationId: null,
          isDraftConversation: false,
          draftSessionKey: 0,
        }),
      setDetailContactId: (id) => set({ detailContactId: id }),
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
      setActiveTab: (tab) => {
        if (tab === "chat") {
          const state = get()
          if (
            !state.curatorNavigationReturn &&
            isEmployeeContactId(state.selectedContactId)
          ) {
            const curatorId = findCuratorContactId(state.contacts)
            if (curatorId) {
              set({
                selectedContactId: curatorId,
                isDraftConversation: false,
                activeTab: tab,
              })
              return
            }
          }
        }
        set({ activeTab: tab })
      },
      setCompactMode: (compact) => set({ isCompactMode: compact }),
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
      switchToContact: (contactId) => {
        if (isEmployeeContactId(contactId)) {
          set({
            detailContactId: contactId,
            activeTab: "contacts" as ActiveTab,
          })
          return
        }
        set((state) => ({
          selectedContactId: contactId,
          selectedConversationId: null,
          isDraftConversation: false,
          draftSessionKey: state.draftSessionKey + 1,
          activeTab: "chat" as ActiveTab,
        }))
      },
      getSelectedContact: () => {
        const { contacts, selectedContactId } = get()
        if (!selectedContactId) return undefined
        return findContactInList(contacts, selectedContactId)
      },
      getDetailContact: () => {
        const { contacts, detailContactId } = get()
        if (!detailContactId) return undefined
        return findContactInList(contacts, detailContactId)
      },
      getCuratorContact: () => {
        const { contacts } = get()
        return contacts.find((c) => c.type === "curator")
      },
      resetToCuratorContact: () => {
        const state = get()
        if (state.curatorNavigationReturn) return
        const curatorId = findCuratorContactId(state.contacts)
        if (!curatorId || state.selectedContactId === curatorId) return
        set({
          selectedContactId: curatorId,
          isDraftConversation: false,
        })
      },
      migrateLegacyEmployeeSelection: () => {
        const state = get()
        if (
          !isEmployeeContactId(state.selectedContactId) ||
          state.curatorNavigationReturn
        ) {
          return
        }
        const employeeId = state.selectedContactId
        const curatorId = findCuratorContactId(state.contacts)
        set({
          detailContactId: state.detailContactId ?? employeeId,
          selectedContactId: curatorId ?? null,
          isDraftConversation: false,
        })
      },
    }),
    {
      name: "chat:selection",
      partialize: (state) => ({
        selectedContactId: state.selectedContactId,
        detailContactId: state.detailContactId,
        selectedConversationId: state.selectedConversationId,
        workbenchCuratorConversationId: state.workbenchCuratorConversationId,
        curatorNavigationReturn: state.curatorNavigationReturn,
        activeTab: state.activeTab,
      }),
      onRehydrateStorage: () => (state) => {
        state?.migrateLegacyEmployeeSelection()
      },
    }
  )
)

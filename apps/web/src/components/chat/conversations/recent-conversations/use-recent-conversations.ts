import * as React from "react"
import { useShallow } from "zustand/react/shallow"
import { useAuthStore } from "@/stores/auth-store"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { findContactInList } from "@/lib/chat/contact-utils"
import type { AIEmployee, Contact } from "@/types/chat"
import { useChatStore } from "@/stores/chat-store"
import { deriveRecentItems } from "./model"
import {
  loadAndMigrateRecentConversations,
  saveRecentConversations,
} from "./persistence"
import type { RecentConversationItem } from "./types"

/** 与 displayItems 排序一致，用于移除当前项后选中下一条 */
function pickNextRecentContactId(
  items: RecentConversationItem[]
): string | undefined {
  if (items.length === 0) return undefined
  const sorted = [...items].sort((a, b) => {
    if (a.isCurator && !b.isCurator) return -1
    if (!a.isCurator && b.isCurator) return 1
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    const ta = a.updatedAt?.getTime() ?? 0
    const tb = b.updatedAt?.getTime() ?? 0
    return tb - ta
  })
  return sorted[0]?.contactId
}

export function useRecentConversations() {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? 1

  const [storedItems, setStoredItems] = React.useState<
    RecentConversationItem[]
  >(() => loadAndMigrateRecentConversations(workspaceId))

  const [loadedWorkspaceId, setLoadedWorkspaceId] =
    React.useState(workspaceId)
  if (workspaceId !== loadedWorkspaceId) {
    setLoadedWorkspaceId(workspaceId)
    setStoredItems(loadAndMigrateRecentConversations(workspaceId))
  }

  const [searchQuery, setSearchQuery] = React.useState("")
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [detailContact, setDetailContact] = React.useState<Contact | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const { selectedContactId, isDraftConversation, switchToContact } =
    useChatStore(
      useShallow((state) => ({
        selectedContactId: state.selectedContactId,
        isDraftConversation: state.isDraftConversation,
        switchToContact: state.switchToContact,
      }))
    )

  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const contacts = useChatStore((s) => s.contacts)

  const employeeList = React.useMemo(
    () =>
      contacts
        .filter((c) => c.type === "employee")
        .map((c) => c.employee)
        .filter(Boolean) as AIEmployee[],
    [contacts]
  )

  const handleCreateGroup = () => {
    setIsDialogOpen(false)
  }

  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    selectedContact
  )

  const recentItems = React.useMemo(
    () =>
      deriveRecentItems(storedItems, {
        contacts,
        conversations,
        selectedContactId,
        selectedContact,
        isDraftConversation,
      }),
    [
      storedItems,
      contacts,
      conversations,
      selectedContactId,
      selectedContact,
      isDraftConversation,
    ]
  )

  const lastPersistedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    const snapshot = JSON.stringify(recentItems)
    if (lastPersistedRef.current === snapshot) return
    lastPersistedRef.current = snapshot
    saveRecentConversations(workspaceId, recentItems)
  }, [workspaceId, recentItems])

  const handleSelectItem = (contactId: string) => {
    if (contactId === selectedContactId) return
    switchToContact(contactId)
  }

  const handleDetail = (item: RecentConversationItem) => {
    const contact = findContactInList(contacts, item.contactId)
    if (contact) {
      setDetailContact(contact)
      setDetailOpen(true)
    }
  }

  const handleTogglePin = (item: RecentConversationItem) => {
    setStoredItems(
      recentItems.map((i) =>
        i.contactId === item.contactId ? { ...i, isPinned: !i.isPinned } : i
      )
    )
  }

  const handleRemove = (item: RecentConversationItem) => {
    const updated = recentItems.filter(
      (i) => i.contactId !== item.contactId
    )
    setStoredItems(updated)

    const { selectedContactId, setSelectedContactId, switchToContact } =
      useChatStore.getState()
    if (selectedContactId !== item.contactId) return

    const nextContactId = pickNextRecentContactId(updated)
    if (nextContactId) {
      switchToContact(nextContactId)
    } else {
      setSelectedContactId(null)
    }
  }

  const displayItems = React.useMemo(() => {
    let items = recentItems
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter(
        (item) =>
          item.contactName.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q)
      )
    }
    return [...items].sort((a, b) => {
      if (a.isCurator && !b.isCurator) return -1
      if (!a.isCurator && b.isCurator) return 1
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      const ta = a.updatedAt?.getTime() ?? 0
      const tb = b.updatedAt?.getTime() ?? 0
      return tb - ta
    })
  }, [recentItems, searchQuery])

  const isItemSelected = (item: RecentConversationItem) =>
    (item.isDraft &&
      isDraftConversation &&
      selectedContactId === item.contactId) ||
    (!item.isDraft && selectedContactId === item.contactId)

  return {
    displayItems,
    searchQuery,
    setSearchQuery,
    selectedContactId,
    isDraftConversation,
    contacts,
    employeeList,
    isDialogOpen,
    setIsDialogOpen,
    handleCreateGroup,
    detailContact,
    detailOpen,
    setDetailOpen,
    handleSelectItem,
    handleDetail,
    handleTogglePin,
    handleRemove,
    isItemSelected,
  }
}

import * as React from "react"
import { useShallow } from "zustand/react/shallow"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import {
  findContactInList,
  type AIEmployee,
  type Contact,
} from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"
import {
  ensureContactInList,
  getContactInfo,
  getCuratorContactId,
  upsertRecentConversation,
} from "./model"
import {
  loadAndMigrateRecentConversations,
  saveRecentConversations,
} from "./persistence"
import type { RecentConversationItem } from "./types"

export function useRecentConversations() {
  const [recentItems, setRecentItems] = React.useState<
    RecentConversationItem[]
  >(() => loadAndMigrateRecentConversations())

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

  React.useEffect(() => {
    const curatorId = getCuratorContactId(contacts)
    if (!curatorId) return
    const curator = contacts.find((c) => c.type === "curator")?.curator
    if (!curator) return
    setRecentItems((prev) => {
      const hasCuratorItem = prev.some((c) => c.contactId === curatorId)
      if (hasCuratorItem) return prev
      const item: RecentConversationItem = {
        id: `recent:${curatorId}`,
        contactId: curatorId,
        contactName: curator.name,
        title: "数字员工统筹",
        unreadCount: 0,
        updatedAt: new Date(),
        avatar: curator.avatar,
        status: curator.status,
        isCurator: true,
      }
      const updated = [item, ...prev]
      saveRecentConversations(updated)
      return updated
    })
  }, [contacts])

  const handleCreateGroup = () => {
    setIsDialogOpen(false)
  }

  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    selectedContact
  )

  React.useEffect(() => {
    if (!selectedContact || selectedContact.type === "curator") return
    if (conversations.length === 0) return
    const storeContacts = useChatStore.getState().contacts
    const contactInfo = getContactInfo(storeContacts, selectedContactId ?? "")
    const curatorId = getCuratorContactId(storeContacts)
    const isGroup = selectedContact.type === "group"
    const participants = isGroup
      ? selectedContact.group?.participants.map((p) => ({
          name: p.name,
          avatar: p.avatar,
        }))
      : undefined

    setRecentItems((prev) => {
      const updated = conversations.reduce(
        (acc, conv) =>
          upsertRecentConversation(
            acc,
            conv,
            contactInfo,
            curatorId,
            isGroup,
            participants
          ),
        prev
      )
      const hasNew =
        updated.length !== prev.length ||
        updated[0]?.id !== prev[0]?.id ||
        updated[0]?.updatedAt?.getTime() !== prev[0]?.updatedAt?.getTime()
      if (hasNew) {
        saveRecentConversations(updated)
        return updated
      }
      return prev
    })
  }, [conversations, selectedContact, selectedContactId])

  React.useEffect(() => {
    if (!selectedContactId) return
    setRecentItems((prev) => {
      const exists = prev.some((c) => c.contactId === selectedContactId)
      if (exists) return prev
      const storeContacts = useChatStore.getState().contacts
      const curatorId = getCuratorContactId(storeContacts)
      const updated = ensureContactInList(
        prev,
        selectedContactId,
        storeContacts,
        curatorId
      )
      saveRecentConversations(updated)
      return updated
    })
  }, [selectedContactId])

  React.useEffect(() => {
    if (isDraftConversation) return
    if (!selectedContactId) return
    const draftItem = recentItems.find(
      (item) => item.isDraft && item.contactId === selectedContactId
    )
    if (!draftItem) return
    setRecentItems((prev) => {
      const updated = prev.filter(
        (item) => !(item.isDraft && item.contactId === selectedContactId)
      )
      saveRecentConversations(updated)
      return updated
    })
  }, [isDraftConversation, recentItems, selectedContactId])

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
    setRecentItems((prev) => {
      const updated = prev.map((i) =>
        i.contactId === item.contactId ? { ...i, isPinned: !i.isPinned } : i
      )
      saveRecentConversations(updated)
      return updated
    })
  }

  const handleRemove = (item: RecentConversationItem) => {
    setRecentItems((prev) => {
      const updated = prev.filter((i) => i.contactId !== item.contactId)
      saveRecentConversations(updated)
      return updated
    })
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

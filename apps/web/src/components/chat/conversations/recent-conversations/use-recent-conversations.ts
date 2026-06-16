import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import {
  useDeleteAllConversationsForContactMutation,
  useRecentContactsQuery,
  useToggleRecentPinMutation,
} from "@/hooks/use-chat-queries"
import { findContactInList } from "@/lib/chat/contact-utils"
import {
  focusAfterContactRemoved,
  resolveRecentContactSelectionId,
  selectConversationForContact,
  switchToContact,
} from "@/lib/chat/conversation-selection"
import { parseRecentItemConversationId } from "@/components/workbench/resolve-workbench-curator-panel"
import { resetChatRightPanels } from "@/lib/chat/reset-chat-right-panels"
import type { Contact } from "@/types/chat"
import { useChatStore } from "@/stores/chat-store"
import { enrichRecentContactsList } from "./model"
import { resolveContactForRecentItem } from "./resolve-recent-contact"
import type { RecentConversationItem } from "./types"

export function useRecentConversations() {
  const [searchQuery, setSearchQuery] = React.useState("")
  const [detailContact, setDetailContact] = React.useState<Contact | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const { selectedContactId, isDraftConversation } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      isDraftConversation: state.isDraftConversation,
    }))
  )

  const contacts = useChatStore((s) => s.contacts)

  const { data: storedItems = [], isLoading: isRecentLoading } =
    useRecentContactsQuery()
  const togglePinMutation = useToggleRecentPinMutation()

  const deleteAllConversationsMutation =
    useDeleteAllConversationsForContactMutation()
  const [removingContactId, setRemovingContactId] = React.useState<
    string | null
  >(null)

  const recentItems = React.useMemo(
    () => enrichRecentContactsList(storedItems, contacts),
    [storedItems, contacts]
  )

  // 最近会话项的 contactId 是裸数字；选择/查找需带 type 前缀以避免群与员工串号。
  const resolveSelectionId = (item: RecentConversationItem): string =>
    resolveRecentContactSelectionId(item, contacts)

  const handleSelectItem = (item: RecentConversationItem) => {
    const selectionId = resolveSelectionId(item)
    const conversationId = parseRecentItemConversationId(item)
    if (conversationId) {
      selectConversationForContact(selectionId, conversationId, {
        touch: false,
      })
    } else {
      switchToContact(selectionId, { touch: false })
    }
    useChatStore.getState().setActiveTab("chat")
  }

  const handleDetail = (item: RecentConversationItem) => {
    const hint: Contact["type"] = item.isCurator ? "curator" : "employee"
    const contact = findContactInList(contacts, item.contactId, hint)
    if (contact) {
      setDetailContact(contact)
      setDetailOpen(true)
    }
  }

  const handleTogglePin = (item: RecentConversationItem) => {
    const contact = resolveContactForRecentItem(
      item.contactId,
      item,
      contacts
    )
    if (!contact) return
    togglePinMutation.mutate({
      contact,
      isPinned: !item.isPinned,
    })
  }

  const handleRemove = async (item: RecentConversationItem) => {
    if (item.isCurator) return

    const contact = resolveContactForRecentItem(
      item.contactId,
      item,
      contacts
    )
    if (!contact) {
      toast.error("无法删除：找不到该联系人")
      return
    }

    setRemovingContactId(item.contactId)
    try {
      await toast.promise(
        deleteAllConversationsMutation.mutateAsync({
          contactId: item.contactId,
          contact,
        }),
        {
          loading: `正在删除与「${item.contactName}」的所有会话…`,
          success: `已删除与「${item.contactName}」的所有会话`,
          error: "删除会话失败，请稍后重试",
        }
      )
    } catch {
      return
    } finally {
      setRemovingContactId(null)
    }

    resetChatRightPanels()

    const { selectedContactId: currentContactId } = useChatStore.getState()
    const remaining = recentItems.filter((i) => i.contactId !== item.contactId)

    focusAfterContactRemoved(
      currentContactId,
      item.contactId,
      remaining,
      contacts,
      item
    )
  }

  const displayItems = React.useMemo(() => {
    if (!searchQuery.trim()) return recentItems
    const q = searchQuery.toLowerCase()
    return recentItems.filter(
      (item) =>
        item.contactName.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q)
    )
  }, [recentItems, searchQuery])

  const isItemSelected = (item: RecentConversationItem) => {
    if (!selectedContactId) return false
    // 严格匹配前缀化选择 id；避免裸 contactId 命中多个同名/同 id 项导致多个高亮
    return selectedContactId === resolveSelectionId(item)
  }

  return {
    displayItems,
    searchQuery,
    setSearchQuery,
    selectedContactId,
    isDraftConversation,
    contacts,
    detailContact,
    detailOpen,
    setDetailOpen,
    handleSelectItem,
    handleDetail,
    handleTogglePin,
    handleRemove,
    isItemSelected,
    removingContactId,
    isRecentLoading,
  }
}

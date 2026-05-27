import { findContactInList } from "@/lib/chat/contact-utils"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { curatorUnreadKey } from "@/lib/constants"
import type { Contact, Conversation } from "@/types/chat"
import { MAX_RECENT, type RecentConversationItem } from "./types"

/** 与 conversation-status-store 未读 key 一致（SSE 运行态角标） */
export function getRecentItemUnreadKey(
  item: Pick<RecentConversationItem, "contactId" | "isCurator" | "isGroup">
): string {
  if (item.isCurator) return curatorUnreadKey(item.contactId)
  return `${item.isGroup ? "group" : "employee"}:${Number(item.contactId)}`
}

export type ContactInfo = {
  id: string
  name: string
  avatar?: string
  status?: string
}

export function getCuratorContactId(contacts: Contact[]): string | undefined {
  const curator = contacts.find((c) => c.type === "curator")
  return curator?.curator?.id
}

/** 去掉联系人已不存在（被删除）的最近会话项，保留有效总管项 */
export function filterRecentItemsExistingContacts(
  items: RecentConversationItem[],
  contacts: Contact[]
): RecentConversationItem[] {
  const curatorId = getCuratorContactId(contacts)
  return items.filter((item) => {
    if (item.isCurator) {
      return curatorId != null && item.contactId === curatorId
    }
    return findContactInList(contacts, item.contactId) != null
  })
}

export function getContactInfo(
  contacts: Contact[],
  contactId: string
): ContactInfo | null {
  const contact = findContactInList(contacts, contactId)
  if (!contact) return null
  if (contact.type === "curator") {
    return {
      id: contact.curator!.id,
      name: contact.curator!.name,
      avatar: CURATOR_AVATAR_URL,
      status: contact.curator!.status,
    }
  }
  if (contact.type === "employee") {
    return {
      id: contact.employee!.id,
      name: contact.employee!.name,
      avatar: contact.employee!.avatar,
      status: contact.employee!.status,
    }
  }
  if (contact.type === "group") {
    return {
      id: contact.group!.id,
      name: contact.group!.name,
    }
  }
  return null
}

export function upsertRecentConversation(
  existing: RecentConversationItem[],
  conv: Conversation,
  contact: ContactInfo | null,
  curatorContactId: string | undefined,
  isGroup = false,
  participants?: { name: string; avatar?: string }[]
): RecentConversationItem[] {
  const existingItem = existing.find((c) => c.contactId === conv.contactId)
  const item: RecentConversationItem = {
    id: conv.id,
    contactId: conv.contactId,
    contactName: contact?.name ?? "未知",
    title: conv.title,
    lastMessage: conv.lastMessage,
    lastMessageTime: conv.lastMessageTime,
    unreadCount: conv.unreadCount,
    updatedAt: conv.updatedAt ?? undefined,
    avatar: contact?.avatar,
    status: contact?.status,
    isGroup,
    isCurator: conv.contactId === curatorContactId,
    isPinned: existingItem?.isPinned,
    participants,
  }
  const filtered = existing.filter((c) => c.contactId !== conv.contactId)
  const updated = [item, ...filtered].slice(0, MAX_RECENT)
  if (item.isCurator) {
    const withoutCurator = updated.filter((c) => !c.isCurator)
    return [item, ...withoutCurator]
  }
  return updated
}

export function ensureContactInList(
  existing: RecentConversationItem[],
  contactId: string,
  contacts: Contact[],
  curatorContactId: string | undefined
): RecentConversationItem[] {
  const exists = existing.some((c) => c.contactId === contactId)
  if (exists) {
    const filtered = existing.filter((c) => c.contactId !== contactId)
    const item = existing.find((c) => c.contactId === contactId)!
    return [item, ...filtered]
  }
  const contactInfo = getContactInfo(contacts, contactId)
  if (!contactInfo) return existing
  const contact = findContactInList(contacts, contactId)
  const isGroup = contact?.type === "group"
  const isCurator =
    contact?.type === "curator" || contactId === curatorContactId
  const newItem: RecentConversationItem = {
    id: `recent:${contactId}`,
    contactId,
    contactName: contactInfo.name,
    title: isCurator ? "数字员工统筹" : "",
    unreadCount: 0,
    updatedAt: new Date(),
    avatar: contactInfo.avatar,
    status: contactInfo.status,
    isGroup,
    isCurator,
    participants: isGroup
      ? contact!.group?.participants.map((p) => ({
          name: p.name,
          avatar: p.avatar,
        }))
      : undefined,
  }
  return [newItem, ...existing].slice(0, MAX_RECENT)
}

export type DeriveRecentItemsParams = {
  contacts: Contact[]
  conversations: Conversation[]
  selectedContactId: string | null
  selectedContact: Contact | null | undefined
  isDraftConversation: boolean
}

/** 从本地存储基线合并联系人、会话列表与当前选中态（无副作用）。 */
export function deriveRecentItems(
  stored: RecentConversationItem[],
  params: DeriveRecentItemsParams
): RecentConversationItem[] {
  let items = filterRecentItemsExistingContacts(stored, params.contacts)

  const curatorId = getCuratorContactId(params.contacts)
  if (curatorId) {
    const curator = params.contacts.find((c) => c.type === "curator")?.curator
    if (curator && !items.some((c) => c.contactId === curatorId)) {
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
      items = [item, ...items]
    }
  }

  if (
    params.selectedContact &&
    params.selectedContact.type !== "curator" &&
    params.conversations.length > 0
  ) {
    const contactInfo = getContactInfo(
      params.contacts,
      params.selectedContactId ?? ""
    )
    const isGroup = params.selectedContact.type === "group"
    const participants = isGroup
      ? params.selectedContact.group?.participants.map((p) => ({
          name: p.name,
          avatar: p.avatar,
        }))
      : undefined
    items = params.conversations.reduce(
      (acc, conv) =>
        upsertRecentConversation(
          acc,
          conv,
          contactInfo,
          curatorId,
          isGroup,
          participants
        ),
      items
    )
  }

  if (params.selectedContactId) {
    items = ensureContactInList(
      items,
      params.selectedContactId,
      params.contacts,
      curatorId
    )
  }

  if (!params.isDraftConversation && params.selectedContactId) {
    items = items.filter(
      (item) =>
        !(item.isDraft && item.contactId === params.selectedContactId)
    )
  }

  return items.map((item) =>
    item.isCurator ? { ...item, avatar: CURATOR_AVATAR_URL } : item,
  )
}

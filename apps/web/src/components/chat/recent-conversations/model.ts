import type { Conversation } from "@/lib/mock-data/conversations"
import { findContactInList, type Contact } from "@/lib/mock-data/ai-employees"
import { MAX_RECENT, type RecentConversationItem } from "./types"

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
      avatar: contact.curator!.avatar,
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

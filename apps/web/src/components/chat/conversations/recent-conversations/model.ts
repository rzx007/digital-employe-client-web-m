import { findContactInList } from "@/lib/chat/contact-utils"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { curatorUnreadKey } from "@/lib/constants"
import type { Contact } from "@/types/chat"
import type { RecentConversationItem } from "./types"

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

/** 去掉联系人已不存在（被删除）的最近会话项 */
export function filterRecentItemsExistingContacts(
  items: RecentConversationItem[],
  contacts: Contact[]
): RecentConversationItem[] {
  const curatorId = getCuratorContactId(contacts)
  return items.filter((item) => {
    if (item.isCurator) {
      return curatorId != null && item.contactId === curatorId
    }
    const hint: Contact["type"] = item.isGroup ? "group" : "employee"
    return findContactInList(contacts, item.contactId, hint) != null
  })
}

export function getContactInfo(
  contacts: Contact[],
  contactId: string,
  typeHint?: Contact["type"]
): ContactInfo | null {
  const contact = findContactInList(contacts, contactId, typeHint)
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

/** 从 contacts 补全头像、群成员、名称（保持 API 返回顺序） */
export function enrichRecentItemFromContacts(
  item: RecentConversationItem,
  contacts: Contact[],
  curatorContactId: string | undefined
): RecentConversationItem {
  const hint: Contact["type"] = item.isCurator
    ? "curator"
    : item.isGroup
      ? "group"
      : "employee"
  const contact = findContactInList(contacts, item.contactId, hint)
  const info = getContactInfo(contacts, item.contactId, hint)
  // isGroup 优先：群的 target_id 可能与 curator id 数值相同（如都为 5），
  // 不能再用裸 id 比对 curatorContactId 判 curator，否则群被误判成总管。
  const isGroup = item.isGroup || contact?.type === "group"
  const isCurator =
    !isGroup &&
    (item.isCurator ||
      contact?.type === "curator" ||
      item.contactId === curatorContactId)

  const participants = isGroup
    ? contact?.group?.participants.map((p) => ({
        name: p.name,
        avatar: p.avatar,
      }))
    : item.participants

  return {
    ...item,
    contactName: info?.name ?? item.contactName,
    avatar: isCurator
      ? CURATOR_AVATAR_URL
      : (info?.avatar ?? item.avatar),
    status: info?.status ?? item.status,
    isCurator,
    isGroup,
    participants: participants ?? item.participants,
  }
}

/** 过滤无效联系人并补全展示字段；顺序与 GET recent-contacts 一致，不重排 */
export function enrichRecentContactsList(
  items: RecentConversationItem[],
  contacts: Contact[]
): RecentConversationItem[] {
  const curatorId = getCuratorContactId(contacts)
  const filtered =
    contacts.length === 0
      ? items
      : filterRecentItemsExistingContacts(items, contacts)
  return filtered.map((item) =>
    enrichRecentItemFromContacts(item, contacts, curatorId)
  )
}

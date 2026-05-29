import type { RecentContactImportItem } from "@/api/recent-contacts"
import { getRecentConversationsKey, type RecentConversationItem } from "./types"

const LEGACY_CURATOR_PRIMARY_ID = "recent:curator-primary"
const OLD_KEY = "app:recent-conversations"

function getRecentContactsImportedKey(workspaceId: number): string {
  return `app:recent-contacts-imported:${workspaceId}`
}

export function hasRecentContactsImported(workspaceId: number): boolean {
  return localStorage.getItem(getRecentContactsImportedKey(workspaceId)) === "1"
}

export function markRecentContactsImported(workspaceId: number): void {
  try {
    localStorage.setItem(getRecentContactsImportedKey(workspaceId), "1")
  } catch {
    // ignore storage errors
  }
}

function migrateOldKeyIfNeeded(workspaceId: number) {
  const oldRaw = localStorage.getItem(OLD_KEY)
  if (!oldRaw) return
  const newKey = getRecentConversationsKey(workspaceId)
  if (localStorage.getItem(newKey)) return
  localStorage.setItem(newKey, oldRaw)
  localStorage.removeItem(OLD_KEY)
}

export function loadRecentConversations(
  workspaceId: number
): RecentConversationItem[] {
  try {
    const raw = localStorage.getItem(getRecentConversationsKey(workspaceId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as RecentConversationItem[]).map((item) => ({
      ...item,
      lastMessageTime: item.lastMessageTime
        ? new Date(item.lastMessageTime as unknown as string)
        : undefined,
      updatedAt: item.updatedAt
        ? new Date(item.updatedAt as unknown as string)
        : undefined,
    }))
  } catch {
    return []
  }
}

export function saveRecentConversations(
  workspaceId: number,
  items: RecentConversationItem[]
) {
  try {
    localStorage.setItem(
      getRecentConversationsKey(workspaceId),
      JSON.stringify(items)
    )
  } catch {
    // ignore storage errors
  }
}

/** Load, migrate legacy rows, persist, return cleaned list. */
export function loadAndMigrateRecentConversations(
  workspaceId: number
): RecentConversationItem[] {
  migrateOldKeyIfNeeded(workspaceId)
  const loaded = loadRecentConversations(workspaceId)
  const cleaned = loaded.filter((c) => c.id !== LEGACY_CURATOR_PRIMARY_ID)
  saveRecentConversations(workspaceId, cleaned)
  return cleaned
}

export function removeRecentConversationByContactId(
  workspaceId: number,
  contactId: string
): void {
  const loaded = loadRecentConversations(workspaceId)
  const next = loaded.filter((item) => item.contactId !== contactId)
  if (next.length === loaded.length) return
  saveRecentConversations(workspaceId, next)
}

/** 将 localStorage 条目转为服务端 import 载荷 */
export function buildRecentContactImportPayload(
  items: RecentConversationItem[]
): RecentContactImportItem[] {
  const payload: RecentContactImportItem[] = []
  for (const item of items) {
    const targetId = Number(item.contactId)
    if (Number.isNaN(targetId)) continue
    let target_type: RecentContactImportItem["target_type"]
    if (item.isCurator) {
      target_type = "curator"
    } else if (item.isGroup) {
      target_type = "group"
    } else {
      target_type = "employee"
    }
    const row: RecentContactImportItem = {
      target_type,
      target_id: targetId,
      is_pinned: item.isPinned ?? false,
    }
    const accessed = item.updatedAt?.toISOString()
    if (accessed) {
      row.last_accessed_at = accessed
    }
    payload.push(row)
  }
  return payload
}

export function clearRecentConversationsStorage(workspaceId: number): void {
  try {
    localStorage.removeItem(getRecentConversationsKey(workspaceId))
    localStorage.removeItem(OLD_KEY)
  } catch {
    // ignore
  }
}

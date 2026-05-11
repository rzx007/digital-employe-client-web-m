import { RECENT_CONVERSATIONS_KEY, type RecentConversationItem } from "./types"

const LEGACY_CURATOR_PRIMARY_ID = "recent:curator-primary"

export function loadRecentConversations(): RecentConversationItem[] {
  try {
    const raw = localStorage.getItem(RECENT_CONVERSATIONS_KEY)
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

export function saveRecentConversations(items: RecentConversationItem[]) {
  try {
    localStorage.setItem(RECENT_CONVERSATIONS_KEY, JSON.stringify(items))
  } catch {
    // ignore storage errors
  }
}

/** Load, migrate legacy rows, persist, return cleaned list. */
export function loadAndMigrateRecentConversations(): RecentConversationItem[] {
  const loaded = loadRecentConversations()
  const cleaned = loaded.filter((c) => c.id !== LEGACY_CURATOR_PRIMARY_ID)
  saveRecentConversations(cleaned)
  return cleaned
}

import {
  getRecentConversationsKey,
  type RecentConversationItem,
} from "./types"

const LEGACY_CURATOR_PRIMARY_ID = "recent:curator-primary"
const OLD_KEY = "app:recent-conversations"

function migrateOldKeyIfNeeded(workspaceId: number) {
  const oldRaw = localStorage.getItem(OLD_KEY)
  if (!oldRaw) return
  const newKey = getRecentConversationsKey(workspaceId)
  if (localStorage.getItem(newKey)) return
  localStorage.setItem(newKey, oldRaw)
  localStorage.removeItem(OLD_KEY)
}

export function loadRecentConversations(
  workspaceId: number,
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
  items: RecentConversationItem[],
) {
  try {
    localStorage.setItem(
      getRecentConversationsKey(workspaceId),
      JSON.stringify(items),
    )
  } catch {
    // ignore storage errors
  }
}

/** Load, migrate legacy rows, persist, return cleaned list. */
export function loadAndMigrateRecentConversations(
  workspaceId: number,
): RecentConversationItem[] {
  migrateOldKeyIfNeeded(workspaceId)
  const loaded = loadRecentConversations(workspaceId)
  const cleaned = loaded.filter((c) => c.id !== LEGACY_CURATOR_PRIMARY_ID)
  saveRecentConversations(workspaceId, cleaned)
  return cleaned
}

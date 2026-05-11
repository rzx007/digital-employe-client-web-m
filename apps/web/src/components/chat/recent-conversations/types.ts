export interface RecentConversationItem {
  id: string
  contactId: string
  contactName: string
  title: string
  lastMessage?: string
  lastMessageTime?: Date
  unreadCount: number
  updatedAt?: Date
  avatar?: string
  status?: string
  isGroup?: boolean
  isDraft?: boolean
  isCurator?: boolean
  isPinned?: boolean
  participants?: { name: string; avatar?: string }[]
}

export const RECENT_CONVERSATIONS_KEY = "app:recent-conversations"
export const MAX_RECENT = 50

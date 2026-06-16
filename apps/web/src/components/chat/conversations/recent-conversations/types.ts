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
  isCurator?: boolean
  isPinned?: boolean
  participants?: { name: string; avatar?: string }[]
}

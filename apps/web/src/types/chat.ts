import type { MetadataSkill } from "@/api/types"

export type MessageRole = "user" | "assistant"

export interface Message {
  id: string
  conversationId: string
  senderId: string
  senderName: string
  role: MessageRole
  content: string
  timestamp: Date
  type?: "text" | "image" | "file"
  metadata?: Record<string, any>
  chunkJson?: string
  streamState?: string | null
  streamCursor?: number | null
  messageParts?: unknown[]
}

export type ConversationStatus = "error" | "idle" | "running" | "unread"

export interface Conversation {
  id: string
  title: string
  contactId: string
  status?: ConversationStatus
  lastMessage?: string
  lastMessageTime?: Date
  lastMessageType?: "text" | "image" | "file"
  unreadCount: number
  updatedAt: Date
  messages?: Message[]
}

export interface AIEmployee {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
  skills?: MetadataSkill[]
}

export type ContactType = "curator" | "employee" | "group"

/** 总管助手：独立身份，不属于员工列表 */
export interface CuratorProfile {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
}

export interface Contact {
  type: ContactType
  curator?: CuratorProfile
  employee?: AIEmployee
  group?: {
    id: string
    name: string
    participants: AIEmployee[]
  }
}

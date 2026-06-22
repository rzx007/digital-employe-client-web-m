/**
 * UI 域聊天模型（camelCase、`Date`、含 contactId 等前端字段）。
 * API 响应形状见 `ChatMessageDto` / `ConversationListItemDto`（`@/api/types`）；
 * 转换见 `@/lib/chat/chat-mappers.ts`；对外请求入口见 `@/api/chat`。
 * 消息列表渲染使用 AI SDK `UIMessage`，见 `mapStoredMessagesToUIMessages`。
 */
import type { MetadataSkill } from "@/api/types"

export type MessageRole = "user" | "assistant"

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  timestamp: Date
  type?: "text" | "image" | "file"
  metadata?: Record<string, any>
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
  sessionFlags?: string | null
}

export interface AIEmployee {
  id: string
  name: string
  role: string
  avatar?: string
  status: "online" | "busy" | "offline"
  specialty: string
  skills?: MetadataSkill[]
  /** 待确认技能候选数（>0 时卡片显示「✨N」角标）。 */
  skillCandidateCount?: number
}

export type ContactType = "curator" | "employee"

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
}

/** 语音消息元数据，随 extra_meta.voice 持久化（snake_case，前后端一致） */
export interface VoiceMessageMeta {
  duration_ms: number
  audio_path: string
  waveform: number[]
}

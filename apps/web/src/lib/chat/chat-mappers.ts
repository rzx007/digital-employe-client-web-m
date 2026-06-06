import type { ChatMessageDto, ConversationListItemDto } from "@/api/types"
import type { Conversation, Message } from "@/types/chat"
import { sanitizeAssistantContent } from "./sanitize-assistant-content"

export function mapChatMessageToMessage(
  msg: ChatMessageDto,
  conversationId: string | number
): Message {
  return {
    id: msg.id,
    conversationId:
      msg.conversationId != null
        ? String(msg.conversationId)
        : String(conversationId),
    senderId:
      msg.senderId ??
      (msg.sender_id != null
        ? String(msg.sender_id)
        : msg.role === "user"
          ? "user"
          : ""),
    // 群时间线优先用后端投影的 sender_label（员工名/"用户"/"组长"）
    senderName:
      msg.senderName ??
      msg.sender_label ??
      (msg.role === "user" ? "我" : ""),
    role: msg.role === "system" ? "assistant" : msg.role,
    // assistant 历史正文兜底净化：剥掉早期版本误拼进 content 的工具结果噪音
    content:
      msg.role === "user"
        ? msg.content
        : sanitizeAssistantContent(msg.content),
    chunkJson: msg.chunk_json,
    streamState: msg.stream_state,
    streamCursor: msg.stream_cursor,
    metadata: msg.extra_meta ?? undefined,
    messageParts: msg.message_parts ?? undefined,
    timestamp: msg.timestamp
      ? new Date(msg.timestamp)
      : msg.created_at
        ? new Date(msg.created_at)
        : new Date(),
  }
}

export function mapConversationListItemToConversation(
  item: ConversationListItemDto,
  contactId: string
): Conversation {
  return {
    id: String(item.id),
    title: item.title,
    contactId,
    status: (item.status as Conversation["status"]) ?? undefined,
    lastMessage: item.lastMessage,
    lastMessageTime: item.lastMessageTime
      ? new Date(item.lastMessageTime)
      : undefined,
    lastMessageType: undefined,
    unreadCount: item.unreadCount ?? 0,
    updatedAt: new Date(item.updated_at),
  }
}

export function mapCreatedConversationListItem(
  item: ConversationListItemDto,
  contactId: string
): Conversation {
  return {
    id: String(item.id),
    title: item.title,
    contactId,
    status: (item.status as Conversation["status"]) ?? undefined,
    unreadCount: item.unreadCount ?? 0,
    updatedAt: new Date(item.updated_at),
  }
}

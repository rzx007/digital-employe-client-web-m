import type { ChatMessageDto, ConversationListItemDto } from "@/api/types"
import type { Conversation, Message } from "@/types/chat"

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
    senderId: msg.senderId ?? (msg.role === "user" ? "user" : ""),
    senderName: msg.senderName ?? (msg.role === "user" ? "我" : ""),
    role: msg.role === "system" ? "assistant" : msg.role,
    content: msg.content,
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

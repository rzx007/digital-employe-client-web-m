import type { RecentContactDto } from "@/api/recent-contacts"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import type { RecentConversationItem } from "@/components/chat/conversations/recent-conversations/types"

export function mapRecentContactDtoToItem(
  dto: RecentContactDto
): RecentConversationItem {
  return {
    id: dto.latest_conversation_id
      ? String(dto.latest_conversation_id)
      : `recent:${dto.contact_id}`,
    contactId: dto.contact_id,
    contactName: dto.contact_name,
    title: dto.title,
    lastMessage: dto.last_message ?? undefined,
    lastMessageTime: dto.last_message_time
      ? new Date(dto.last_message_time)
      : undefined,
    unreadCount: dto.unread_count,
    updatedAt: new Date(dto.updated_at),
    avatar: dto.is_curator ? CURATOR_AVATAR_URL : undefined,
    status: dto.status ?? undefined,
    isGroup: dto.is_group,
    isCurator: dto.is_curator,
    isPinned: dto.is_pinned,
  }
}

import { findContactInList } from "@/lib/chat/contact-utils"
import type { AIEmployee, Contact } from "@/types/chat"
import type { RecentConversationItem } from "./types"

/** 为最近会话项解析 Contact，用于拉取/删除该联系人的全部会话 */
export function resolveContactForRecentItem(
  contactId: string,
  item: Pick<
    RecentConversationItem,
    "isCurator" | "isGroup" | "contactName" | "avatar" | "status" | "participants"
  >,
  contacts: Contact[]
): Contact | null {
  if (item.isCurator) return null

  const found = findContactInList(contacts, contactId)
  if (found) return found

  if (item.isGroup) {
    return {
      type: "group",
      group: {
        id: contactId,
        name: item.contactName,
        participants: (item.participants ?? []).map((p) => ({
          id: p.name,
          name: p.name,
          role: "",
          status: "online" as const,
          specialty: "",
          avatar: p.avatar,
        })),
      },
    }
  }

  return {
    type: "employee",
    employee: {
      id: contactId,
      name: item.contactName,
      role: "",
      avatar: item.avatar,
      status: (item.status as AIEmployee["status"]) ?? "offline",
      specialty: "",
    },
  }
}

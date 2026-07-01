import { chatKeys } from "@/lib/query-keys/chat"
import { getActiveWorkspaceId } from "@/lib/workspace-id"

/** 当前活跃项目的会话列表 QueryKey */
export function conversationListQueryKey(
  contactId: string,
  workspaceId = getActiveWorkspaceId()
) {
  return chatKeys.conversations(workspaceId, contactId)
}

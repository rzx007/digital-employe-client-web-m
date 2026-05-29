import { touchRecentContact } from "@/api/recent-contacts"
import { mapContactToTarget } from "@/lib/chat/contact-target"
import { findContactInList } from "@/lib/chat/contact-utils"
import { chatKeys } from "@/lib/query-keys/chat"
import { getQueryClient } from "@/lib/query-client"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import { useChatStore } from "@/stores/chat-store"

export async function refetchRecentContacts(): Promise<void> {
  const workspaceId = getActiveWorkspaceId()
  await getQueryClient().refetchQueries({
    queryKey: chatKeys.recentContacts(workspaceId),
  })
}

export async function touchRecentContactById(
  contactId: string,
  options?: { refetch?: boolean }
): Promise<void> {
  const contact = findContactInList(
    useChatStore.getState().contacts,
    contactId
  )
  if (!contact) return

  const target = mapContactToTarget(contact)
  if (!target) return

  const workspaceId = getActiveWorkspaceId()
  await touchRecentContact(target, { workspaceId })

  if (options?.refetch !== false) {
    await refetchRecentContacts()
  }
}

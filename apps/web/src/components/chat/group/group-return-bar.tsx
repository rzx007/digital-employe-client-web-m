import { IconArrowLeft } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { findContactInList } from "@/lib/chat/contact-utils"
import {
  returnToGroupFromEmployeeNavigation,
  shouldShowGroupReturnBar,
} from "@/lib/chat/group-navigation"
import { useChatStore } from "@/stores/chat-store"

export function GroupReturnBar({ className }: { className?: string }) {
  const ctx = useChatStore((s) => s.groupNavigationReturn)
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const contacts = useChatStore((s) => s.contacts)

  if (
    !shouldShowGroupReturnBar(
      ctx,
      selectedContactId,
      selectedConversationId
    )
  ) {
    return null
  }

  const groupContact = findContactInList(contacts, ctx!.groupContactId)
  const groupName =
    groupContact?.group?.name ??
    groupContact?.name ??
    "群聊"

  return (
    <div
      className={cn(
        "flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground",
        className
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={() => returnToGroupFromEmployeeNavigation()}
      >
        <IconArrowLeft className="size-3.5" />
        返回 {groupName}
      </Button>
      <span className="text-[11px] text-muted-foreground/70">
        正在查看该成员的执行会话
      </span>
    </div>
  )
}

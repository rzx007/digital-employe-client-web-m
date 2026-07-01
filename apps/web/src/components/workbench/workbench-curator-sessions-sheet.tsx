import {
  Sheet,
  SheetContent,
} from "@workspace/ui/components/sheet"

import { ConversationList } from "@/components/chat/conversations/conversation-list"
import type { Contact } from "@/types/chat"

export function WorkbenchCuratorSessionsSheet({
  open,
  onOpenChange,
  curatorContact,
  selectedConversationId,
  onSelectConversation,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  curatorContact?: Contact
  selectedConversationId?: string | number | null
  onSelectConversation?: (conversationId: string | number) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex min-h-0 w-full flex-col gap-0 p-0 sm:max-w-xs"
      >
        <ConversationList
          className="h-full min-h-0"
          contactOverride={curatorContact}
          selectedConversationIdOverride={selectedConversationId}
          onSelectConversationId={onSelectConversation}
          createConversationSelectScope="workbench"
          onClose={() => onOpenChange(false)}
          onSelectConversation={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

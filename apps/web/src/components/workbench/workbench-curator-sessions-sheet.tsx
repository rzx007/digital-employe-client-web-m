import {
  Sheet,
  SheetContent,
} from "@workspace/ui/components/sheet"

import { ConversationList } from "@/components/chat/conversations/conversation-list"

export function WorkbenchCuratorSessionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
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
          onClose={() => onOpenChange(false)}
          onSelectConversation={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  )
}

import { IconArrowLeft } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  returnToCuratorFromEmployeeNavigation,
  shouldShowCuratorReturnBar,
} from "@/lib/chat/curator-navigation"
import { useChatStore } from "@/stores/chat-store"

export function CuratorReturnBar({ className }: { className?: string }) {
  const ctx = useChatStore((s) => s.curatorNavigationReturn)
  const selectedContactId = useChatStore((s) => s.selectedContactId)
  const selectedConversationId = useChatStore((s) => s.selectedConversationId)
  const contacts = useChatStore((s) => s.contacts)

  if (
    !shouldShowCuratorReturnBar(
      ctx,
      selectedContactId,
      selectedConversationId
    )
  ) {
    return null
  }

  const curatorName =
    contacts.find(
      (c) => c.type === "curator" && c.curator?.id === ctx!.curatorContactId
    )?.curator?.name ?? "总管助手"

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
        onClick={() => returnToCuratorFromEmployeeNavigation()}
      >
        <IconArrowLeft className="size-3.5" />
        返回 {curatorName}
      </Button>
      <span className="text-[11px] text-muted-foreground/70">
        正在查看员工执行详情
      </span>
    </div>
  )
}

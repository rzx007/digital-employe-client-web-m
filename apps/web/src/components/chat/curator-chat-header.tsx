import { cn } from "@workspace/ui/lib/utils"
import { Separator } from "@workspace/ui/components/separator"
import type { ChatViewContact } from "./chat-view-shared"
import { EmployeeContactAvatar } from "./contact-avatars"

export function CuratorChatHeader({
  contact,
  className,
}: {
  contact?: ChatViewContact
  className?: string
}) {
  return (
    <div
      className={cn("flex items-center justify-between border-b px-6 py-3", className)}
    >
      <div className="flex min-w-0 items-center gap-3">
        <EmployeeContactAvatar
          name={contact?.curator?.name}
          avatar={contact?.curator?.avatar}
          status={contact?.curator?.status}
          showStatus
        />
        <Separator orientation="vertical" className="h-5 self-center" />
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-sm font-medium">总管助手</h3>
          <p className="truncate text-xs text-muted-foreground">
            分发任务 · 查看员工执行结果
          </p>
        </div>
      </div>
    </div>
  )
}

import { IconDots, IconTrash } from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { ChatViewContact } from "./chat-view-shared"
import { EmployeeContactAvatar } from "./contact-avatars"

export function CuratorChatHeader({
  contact,
  onReset,
  className,
}: {
  contact?: ChatViewContact
  onReset?: () => void
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

      {onReset && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm">
              <IconDots className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onReset}>
              <IconTrash className="size-4" />
              清空会话
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

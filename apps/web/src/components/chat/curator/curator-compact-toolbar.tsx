import {
  IconDots,
  IconFolder,
  IconHistory,
  IconMessage2Plus,
  IconTrash,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useDebouncedCuratorNewConversation } from "@/hooks/use-debounced-curator-new-conversation"
import { cn } from "@workspace/ui/lib/utils"
import type { ChatViewContact } from "../shared/chat-view-shared"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"

export function CuratorCompactToolbar({
  contact,
  conversationId,
  displayName = "总管助手",
  conversationTitle,
  onReset,
  onOpenConversations,
  onNewConversation,
  isCreatingConversation,
  resourcesOpen = false,
  onToggleResources,
  className,
}: {
  contact?: ChatViewContact
  conversationId?: string | number | null
  displayName?: string
  conversationTitle?: string
  onReset?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  isCreatingConversation?: boolean
  resourcesOpen?: boolean
  onToggleResources?: () => void
  className?: string
}) {
  const handleNewConversation =
    useDebouncedCuratorNewConversation(onNewConversation)
  const name =
    contact?.type === "curator"
      ? (contact.curator?.name ?? displayName)
      : displayName

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between gap-2 border-b px-2 py-2",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <EmployeeContactAvatar
          name={name}
          avatar={
            contact?.type === "curator" ? contact.curator?.avatar : undefined
          }
          status={
            contact?.type === "curator" ? contact.curator?.status : undefined
          }
          showStatus
          avatarClassName="size-7"
          fallbackClassName="text-[10px]"
        />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          {conversationTitle ? (
            <span className="truncate text-[10px] text-muted-foreground">
              {conversationTitle}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {onNewConversation && (
          <Button
            title="新建对话"
            variant="ghost"
            size="icon-sm"
            disabled={isCreatingConversation}
            onClick={handleNewConversation}
          >
            <IconMessage2Plus className="size-4" />
          </Button>
        )}
        {onOpenConversations && (
          <Button
            title="历史会话"
            variant="ghost"
            size="icon-sm"
            onClick={onOpenConversations}
          >
            <IconHistory className="size-4" />
          </Button>
        )}
        {conversationId != null && onToggleResources && (
          <Button
            title={resourcesOpen ? "收起资源管理器" : "打开资源管理器"}
            variant="ghost"
            size="icon-sm"
            onClick={onToggleResources}
          >
            <IconFolder className="size-4" />
          </Button>
        )}
        {onReset && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="更多操作">
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
    </div>
  )
}

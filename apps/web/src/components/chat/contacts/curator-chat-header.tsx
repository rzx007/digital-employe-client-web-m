import {
  IconDots,
  IconFolder,
  IconHistory,
  IconMessage2Plus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useDebouncedCuratorNewConversation } from "@/hooks/use-debounced-curator-new-conversation"
import { useIsMobile } from "@/hooks/use-mobile"
import { useArtifactStore } from "@/stores/artifact-store"
import { Separator } from "@workspace/ui/components/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import type { ChatViewContact } from "../shared/chat-view-shared"
import { EmployeeContactAvatar } from "./contact-avatars"

export function CuratorChatHeader({
  contact,
  conversationId,
  title,
  onReset,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  isCreatingConversation,
  className,
}: {
  contact?: ChatViewContact
  conversationId?: string | number | null
  title?: string
  onReset?: () => void
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  isCreatingConversation?: boolean
  className?: string
}) {
  const handleNewConversation =
    useDebouncedCuratorNewConversation(onNewConversation)
  const isMobile = useIsMobile()
  const isArtifactPanelOpen = useArtifactStore((s) => s.isPanelOpen)
  const setArtifactPanelOpen = useArtifactStore((s) => s.setPanelOpen)

  return (
    <div
      className={cn(
        "flex items-center justify-between border-b px-6 py-3",
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {isMobile && onOpenContacts && (
          <Button variant="ghost" size="icon-sm" onClick={onOpenContacts}>
            <IconUsers className="size-4" />
          </Button>
        )}
        <EmployeeContactAvatar
          name={contact?.curator?.name}
          avatar={contact?.curator?.avatar}
          status={contact?.curator?.status}
          showStatus
        />
        <Separator orientation="vertical" className="h-5 self-center" />
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate text-sm font-medium">
            {title?.trim() || "总管助手"}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            分发任务 · 查看员工执行结果
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
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
        {conversationId != null && (
          <Button
            title={isArtifactPanelOpen ? "收起资源管理器" : "打开资源管理器"}
            variant="ghost"
            size="icon-sm"
            onClick={() => setArtifactPanelOpen(!isArtifactPanelOpen)}
          >
            <IconFolder className="size-4" />
          </Button>
        )}
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
    </div>
  )
}

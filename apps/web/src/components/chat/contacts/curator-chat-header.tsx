import * as React from "react"
import { toast } from "sonner"
import {
  IconChecklist,
  IconDots,
  IconFolder,
  IconHistory,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useQueryClient } from "@tanstack/react-query"
import { useIsMobile } from "@/hooks/use-mobile"
import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { getContactId } from "@/lib/chat/contact-utils"
import { focusAfterDeletedConversation } from "@/lib/chat/conversation-selection"
import { useArtifactStore } from "@/stores/artifact-store"
import { useTasksPanelStore } from "@/stores/tasks-panel-store"
import { useUnifiedRunningCount } from "@/hooks/use-unified-tasks"
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
  onOpenContacts,
  onOpenConversations,
  className,
}: {
  contact?: ChatViewContact
  conversationId?: string | number | null
  title?: string
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  // 新建对话入口已统一到侧栏「+」，聊天头不再渲染该按钮（保留 prop 兼容调用方）。
  onNewConversation?: () => void
  isCreatingConversation?: boolean
  className?: string
}) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteConversationMutation()
  const isArtifactPanelOpen = useArtifactStore((s) => s.isPanelOpen)
  const setArtifactPanelOpen = useArtifactStore((s) => s.setPanelOpen)
  const isTasksPanelOpen = useTasksPanelStore((s) => s.isOpen)
  const toggleTasksPanel = useTasksPanelStore((s) => s.toggle)
  const runningTaskCount = useUnifiedRunningCount(conversationId)

  const displayTitle = title?.trim() || "总管助手"
  const contactId = getContactId(contact)

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    if (!contactId || conversationId == null) return

    deleteMutation.mutate(
      {
        conversationId: String(conversationId),
        contactId,
      },
      {
        onSuccess: async () => {
          toast.success(`已删除「${displayTitle}」`)
          try {
            await focusAfterDeletedConversation(
              queryClient,
              contactId,
              conversationId,
              contact
            )
          } catch {
            // 总管删光后 create 失败时 toast 已在 focus 内处理
          }
        },
        onError: () => {
          toast.error("删除失败，请稍后重试")
        },
      }
    )
  }

  return (
    <>
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
            <h3 className="truncate text-sm font-medium">{displayTitle}</h3>
            <p className="truncate text-xs text-muted-foreground">
              分发任务 · 查看员工执行结果
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
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
              title={isTasksPanelOpen ? "收起任务" : "查看任务"}
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={toggleTasksPanel}
            >
              <IconChecklist className="size-4" />
              {runningTaskCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {runningTaskCount}
                </span>
              )}
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
          {conversationId != null && contactId && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <IconDots className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={handleDeleteClick}
                >
                  <IconTrash />
                  <span>删除会话</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{displayTitle}」吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

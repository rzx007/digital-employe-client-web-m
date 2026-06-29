import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import {
  IconCalendar,
  IconArchive,
  IconChecklist,
  IconFolder,
  IconMessage2Plus,
  IconDots,
  IconHistory,
  IconPencil,
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
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useQueryClient } from "@tanstack/react-query"
import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { focusAfterDeletedConversation } from "@/lib/chat/conversation-selection"
import { useIsMobile } from "@/hooks/use-mobile"
import { useArtifactStore } from "@/stores/artifact-store"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { useTasksPanelStore } from "@/stores/tasks-panel-store"
import { useUnifiedRunningCount } from "@/hooks/use-unified-tasks"
import { cn } from "@workspace/ui/lib/utils"
import { Separator } from "@workspace/ui/components/separator"
import type { ChatViewContact } from "../shared/chat-view-shared"

import { EmployeeContactAvatar } from "../contacts/contact-avatars"

interface ChatPanelHeaderProps {
  title: string
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}

export function ChatPanelHeader({
  title,
  contact,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
}: ChatPanelHeaderProps) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const { selectedContactId, selectedConversationId } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
    }))
  )
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteConversationMutation()
  const openMonitor = useMonitorStore((s) => s.openMonitor)
  const isArtifactPanelOpen = useArtifactStore((s) => s.isPanelOpen)
  const setArtifactPanelOpen = useArtifactStore((s) => s.setPanelOpen)
  const isCompactMode = useChatStore((s) => s.isCompactMode)
  const isTasksPanelOpen = useTasksPanelStore((s) => s.isOpen)
  const toggleTasksPanel = useTasksPanelStore((s) => s.toggle)
  const runningTaskCount = useUnifiedRunningCount(selectedConversationId)

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    if (!selectedContactId || !selectedConversationId) return

    deleteMutation.mutate(
      {
        conversationId: String(selectedConversationId),
        contactId: selectedContactId,
      },
      {
        onSuccess: async () => {
          toast.success(`已删除「${title}」`)
          try {
            await focusAfterDeletedConversation(
              queryClient,
              selectedContactId,
              selectedConversationId,
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
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <>
              {onOpenContacts && (
                <Button variant="ghost" size="icon-sm" onClick={onOpenContacts}>
                  <IconUsers className="size-4" />
                </Button>
              )}
            </>
          )}
          {contact && (
            <>
              {contact.type === "curator" ? (
                <EmployeeContactAvatar
                  name={contact.curator?.name}
                  avatar={contact.curator?.avatar}
                  status={contact.curator?.status}
                  showStatus
                />
              ) : (
                <EmployeeContactAvatar
                  name={contact.employee?.name}
                  avatar={contact.employee?.avatar}
                  status={contact.employee?.status}
                  showStatus
                />
              )}
              <Separator orientation="vertical" className="h-5 self-center" />
            </>
          )}
          <h3
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              isCompactMode ? "max-w-[120px]" : "max-w-[200px]"
            )}
            title={title}
          >
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-1">
          {!isCompactMode && onNewConversation && (
            <Button
              title="新建对话"
              variant="ghost"
              size="icon-sm"
              onClick={onNewConversation}
            >
              <IconMessage2Plus className="size-4" />
            </Button>
          )}
          {!isCompactMode && onOpenConversations && (
            <Button
              title="历史话列表"
              variant="ghost"
              size="icon-sm"
              onClick={onOpenConversations}
            >
              <IconHistory className="size-4" />
            </Button>
          )}
          {selectedConversationId && (
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
          {selectedConversationId && (
            <Button
              title={isArtifactPanelOpen ? "收起资源管理器" : "打开资源管理器"}
              variant="ghost"
              size="icon-sm"
              onClick={() => setArtifactPanelOpen(!isArtifactPanelOpen)}
            >
              <IconFolder className="size-4" />
            </Button>
          )}
          {selectedConversationId && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm">
                  <IconDots className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                {contact?.type === "employee" && (
                  <DropdownMenuItem
                    onSelect={() =>
                      openMonitor(
                        contact?.employee?.id ?? "",
                        contact?.employee?.name ?? ""
                      )
                    }
                  >
                    <IconCalendar className="text-muted-foreground" />
                    <span>监控</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem>
                  <IconPencil className="text-muted-foreground" />
                  <span>重命名</span>
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <IconArchive className="text-muted-foreground" />
                  <span>归档</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={handleDeleteClick}
                >
                  <IconTrash />
                  <span>删除</span>
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
              确定要删除「{title}」吗？删除后不可恢复。
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

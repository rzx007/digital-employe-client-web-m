import * as React from "react"
import { toast } from "sonner"
import {
  IconChecklist,
  IconDots,
  IconFolder,
  IconHistory,
  IconTrash,
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
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { useQueryClient } from "@tanstack/react-query"
import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { getContactId } from "@/lib/chat/contact-utils"
import { focusAfterDeletedConversation } from "@/lib/chat/conversation-selection"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
import { ACTIVE_TASK_RUN_STATUSES } from "@/types/schedule-monitor"
import { cn } from "@workspace/ui/lib/utils"
import type { ChatViewContact } from "../shared/chat-view-shared"
import { EmployeeContactAvatar } from "../contacts/contact-avatars"

export function CuratorCompactToolbar({
  contact,
  conversationId,
  displayName = "总管助手",
  conversationTitle,
  onOpenConversations,
  resourcesOpen = false,
  onToggleResources,
  employeeTasksOpen = false,
  onToggleEmployeeTasks,
  className,
}: {
  contact?: ChatViewContact
  conversationId?: string | number | null
  displayName?: string
  conversationTitle?: string
  onOpenConversations?: () => void
  // 新建对话入口已统一到侧栏「+」，紧凑工具栏不再渲染该按钮（保留 prop 兼容调用方）。
  onNewConversation?: () => void
  isCreatingConversation?: boolean
  resourcesOpen?: boolean
  onToggleResources?: () => void
  employeeTasksOpen?: boolean
  onToggleEmployeeTasks?: () => void
  className?: string
}) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteConversationMutation()
  const storeEmployeeTasksOpen = useEmployeeTasksPanelStore((s) => s.isOpen)
  const storeToggleEmployeeTasks = useEmployeeTasksPanelStore((s) => s.toggle)
  const useLocalEmployeeTasks = onToggleEmployeeTasks != null
  const isEmployeeTasksPanelOpen = useLocalEmployeeTasks
    ? employeeTasksOpen
    : storeEmployeeTasksOpen
  const handleEmployeeTasksClick = useLocalEmployeeTasks
    ? onToggleEmployeeTasks
    : storeToggleEmployeeTasks
  const { data: executions = [] } = useCuratorTaskExecutions(conversationId)
  const runningTaskCount = executions.filter((e) =>
    ACTIVE_TASK_RUN_STATUSES.has(e.run_status)
  ).length
  const name =
    contact?.type === "curator"
      ? (contact.curator?.name ?? displayName)
      : displayName

  const deleteTitle = conversationTitle?.trim() || name
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
          toast.success(`已删除「${deleteTitle}」`)
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
              title={isEmployeeTasksPanelOpen ? "收起员工任务" : "员工任务"}
              variant="ghost"
              size="icon-sm"
              className="relative"
              onClick={handleEmployeeTasksClick}
            >
              <IconChecklist className="size-4" />
              {runningTaskCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                  {runningTaskCount}
                </span>
              )}
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
          {conversationId != null && contactId && (
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="更多操作">
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
              确定要删除「{deleteTitle}」吗？删除后不可恢复。
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

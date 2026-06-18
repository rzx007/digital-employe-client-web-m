import {
  IconChecklist,
  IconDots,
  IconFolder,
  IconHistory,
  IconTrash,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
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
  onReset,
  onOpenConversations,
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
  // 新建对话入口已统一到侧栏「+」，紧凑工具栏不再渲染该按钮（保留 prop 兼容调用方）。
  onNewConversation?: () => void
  isCreatingConversation?: boolean
  resourcesOpen?: boolean
  onToggleResources?: () => void
  className?: string
}) {
  const isEmployeeTasksPanelOpen = useEmployeeTasksPanelStore((s) => s.isOpen)
  const toggleEmployeeTasksPanel = useEmployeeTasksPanelStore((s) => s.toggle)
  const { data: executions = [] } = useCuratorTaskExecutions(conversationId)
  const runningTaskCount = executions.filter((e) =>
    ACTIVE_TASK_RUN_STATUSES.has(e.run_status)
  ).length
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
            onClick={toggleEmployeeTasksPanel}
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

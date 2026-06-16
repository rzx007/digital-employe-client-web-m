import {
  IconChecklist,
  IconDots,
  IconFolder,
  IconHistory,
  IconLayoutGrid,
  IconMessage2Plus,
  IconTrash,
  IconUsers,
} from "@tabler/icons-react"
import { cn } from "@workspace/ui/lib/utils"
import { Button } from "@workspace/ui/components/button"
import { useDebouncedCuratorNewConversation } from "@/hooks/use-debounced-curator-new-conversation"
import { useIsMobile } from "@/hooks/use-mobile"
import { useArtifactStore } from "@/stores/artifact-store"
import { useSubtaskPanelStore } from "@/stores/subtask-panel-store"
import { useEmployeeTasksPanelStore } from "@/stores/employee-tasks-panel-store"
import { useCuratorTaskExecutions } from "@/hooks/use-schedule-monitor-queries"
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
  const isSubtaskPanelOpen = useSubtaskPanelStore((s) => s.isOpen)
  const toggleSubtaskPanel = useSubtaskPanelStore((s) => s.toggle)
  const subtaskCount = useSubtaskPanelStore((s) => s.subtasks.length)
  const isEmployeeTasksPanelOpen = useEmployeeTasksPanelStore((s) => s.isOpen)
  const toggleEmployeeTasksPanel = useEmployeeTasksPanelStore((s) => s.toggle)
  const { data: executions = [] } = useCuratorTaskExecutions(conversationId)
  const runningTaskCount = executions.filter(
    (e) =>
      e.run_status === "running" ||
      e.run_status === "queued" ||
      e.run_status === "pending" ||
      e.run_status === "stuck"
  ).length

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
        {conversationId != null && subtaskCount > 0 && (
          <Button
            title={isSubtaskPanelOpen ? "收起并行子任务" : "查看并行子任务"}
            variant="ghost"
            size="icon-sm"
            className="relative"
            onClick={toggleSubtaskPanel}
          >
            <IconLayoutGrid className="size-4" />
            <span className="absolute -top-0.5 -right-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
              {subtaskCount}
            </span>
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

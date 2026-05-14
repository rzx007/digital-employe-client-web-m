import * as React from "react"
import {
  IconBell,
  IconBellFilled,
  IconCheck,
  IconCircleCheckFilled,
  IconExternalLink,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Separator } from "@workspace/ui/components/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { cn } from "@workspace/ui/lib/utils"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { TaskExecution } from "@/types/schedule-monitor"
import {
  useAllTaskExecutions,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from "@/hooks/use-schedule-monitor-queries"
import { useNotificationStore } from "@/stores/notification-store"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  success: {
    label: "成功",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  },
  failed: {
    label: "失败",
    className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  },
  timeout: {
    label: "超时",
    className:
      "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  },
  stuck: {
    label: "卡死",
    className:
      "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  },
  running: {
    label: "执行中",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  },
  pending: {
    label: "待执行",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  },
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(iso: string): string {
  return format(new Date(iso), "HH:mm", { locale: zhCN })
}

function getUserPrompt(input: Record<string, unknown>): string {
  return (input as { user_prompt?: string })?.user_prompt ?? ""
}

function NotificationItem({
  execution,
  onMarkRead,
}: {
  execution: TaskExecution
  onMarkRead: (id: number) => void
}) {
  const isUnread = !execution.is_read
  const config = STATUS_CONFIG[execution.run_status] ?? STATUS_CONFIG.pending
  const resultText = execution.run_result ?? ""
  const promptText = getUserPrompt(execution.input)

  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors",
        isUnread
          ? "border-primary/20 bg-primary/[0.02]"
          : "border-border opacity-70"
      )}
    >
      <div className="flex shrink-0 pt-1.5">
        {isUnread ? (
          <span className="block size-2 rounded-full bg-blue-500" />
        ) : (
          <span className="block size-2 rounded-full bg-muted-foreground/30" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="shrink-0 text-xs text-muted-foreground">
              {execution.employee_name}
            </span>
            <span className="truncate font-medium">{execution.task_name}</span>
          </div>
          {isUnread ? (
            <Button
              variant="outline"
              size="xs"
              className="shrink-0 gap-1 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
              onClick={() => onMarkRead(execution.id)}
            >
              <IconCheck className="size-3" />
              标记为已读
            </Button>
          ) : (
            <IconCircleCheckFilled className="size-3.5 shrink-0 text-muted-foreground/25" />
          )}
        </div>

        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge
            variant="outline"
            className={cn("px-1 py-0 text-[10px]", config.className)}
          >
            {config.label}
          </Badge>
          <span>{formatDuration(execution.duration_ms)}</span>
          <span>·</span>
          <span>{formatTime(execution.started_at)}</span>
        </div>

        <div className="mt-1 flex items-start gap-1">
          {promptText && (
            <p className="line-clamp-1 flex-1 text-xs text-muted-foreground/80 italic">
              "{promptText}"
            </p>
          )}
          {resultText && !promptText && (
            <p className="line-clamp-1 flex-1 text-xs text-muted-foreground/80">
              {resultText}
            </p>
          )}
          {execution.confirm_url && (
            <a
              href={execution.confirm_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-primary hover:underline"
            >
              查看详情
              <IconExternalLink className="size-2.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

export function NotificationBell() {
  const { data: executions = [] } = useAllTaskExecutions()
  const notifications = React.useMemo(
    () => executions.filter((e) => e.confirm_execution_result),
    [executions],
  )
  const dialogOpen = useNotificationStore((s) => s.dialogOpen)
  const setDialogOpen = useNotificationStore((s) => s.setDialogOpen)
  const autoPopupDisabled = useNotificationStore((s) => s.autoPopupDisabled)
  const setAutoPopupDisabled = useNotificationStore(
    (s) => s.setAutoPopupDisabled
  )

  const unreadItems = notifications.filter((n) => !n.is_read)
  const unreadCount = unreadItems.length
  const sortedNotifications = React.useMemo(
    () =>
      [...notifications].sort(
        (a, b) =>
          new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
      ),
    [notifications]
  )

  const prevCountRef = React.useRef(unreadCount)
  React.useEffect(() => {
    if (
      !autoPopupDisabled &&
      unreadCount > 0 &&
      unreadCount > prevCountRef.current
    ) {
      setDialogOpen(true)
    }
    prevCountRef.current = unreadCount
  }, [unreadCount, autoPopupDisabled, setDialogOpen])

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-10 rounded-lg text-muted-foreground hover:text-foreground"
            onClick={() => setDialogOpen(true)}
          >
            {unreadCount > 0 ? (
              <IconBellFilled className="size-5 text-primary" />
            ) : (
              <IconBell className="size-5" />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex animate-pulse items-center justify-center rounded-full bg-destructive p-0.5 px-1 text-[10px] font-bold text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          消息通知{unreadCount > 0 ? ` (${unreadCount}条未读)` : ""}
        </TooltipContent>
      </Tooltip>

      <NotificationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        notifications={sortedNotifications}
        unreadCount={unreadCount}
        autoPopupDisabled={autoPopupDisabled}
        onAutoPopupDisabledChange={setAutoPopupDisabled}
      />
    </>
  )
}

function NotificationDialog({
  open,
  onOpenChange,
  notifications,
  unreadCount,
  autoPopupDisabled,
  onAutoPopupDisabledChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  notifications: TaskExecution[]
  unreadCount: number
  autoPopupDisabled: boolean
  onAutoPopupDisabledChange: (disabled: boolean) => void
}) {
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const unreadIds = React.useMemo(
    () => notifications.filter((n) => !n.is_read).map((n) => n.id),
    [notifications]
  )

  const handleMarkAllRead = () => {
    if (unreadIds.length > 0) {
      markAllRead.mutate(unreadIds)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] max-w-lg flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            消息通知
            {unreadCount > 0 && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                {unreadCount}条未读
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Separator />

        <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <IconBell className="size-8 stroke-1" />
              <p className="mt-2 text-sm">暂无通知消息</p>
            </div>
          ) : (
            notifications.map((n) => (
              <NotificationItem
                key={n.id}
                execution={n}
                onMarkRead={(id) => markRead.mutate(id)}
              />
            ))
          )}
        </div>

        <Separator />

        <DialogFooter className="px-5 py-2.5">
          <div className="flex w-full items-center justify-between">
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={handleMarkAllRead}
                disabled={markAllRead.isPending}
              >
                <IconCheck className="mr-1 size-3" />
                全部已读
              </Button>
            )}
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={autoPopupDisabled}
                onChange={(e) => onAutoPopupDisabledChange(e.target.checked)}
                className="rounded border-border"
              />
              不再自动弹出通知
            </label>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

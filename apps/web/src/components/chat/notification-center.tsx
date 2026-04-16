import * as React from "react"
import {
  IconBell,
  IconBellFilled,
  IconCheck,
  IconCircle,
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
  useNotifications,
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

  return (
    <div
      className={cn(
        "group flex gap-3 rounded-lg border p-3 transition-colors",
        isUnread ? "border-primary/20 bg-primary/[0.02]" : "border-border"
      )}
    >
      <div className="flex shrink-0 pt-0.5">
        {isUnread ? (
          <IconCircle className="size-3 fill-blue-500 text-blue-500" />
        ) : (
          <IconCircleCheckFilled className="size-3 text-muted-foreground/40" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {execution.employee_name}
          </span>
          <span className="text-muted-foreground">·</span>
          <span className="truncate text-sm text-muted-foreground">
            {execution.task_name}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant="outline"
            className={cn("px-1 py-0 text-[10px]", config.className)}
          >
            {config.label}
          </Badge>
          <span>{formatDuration(execution.duration_ms)}</span>
          <span>{formatTime(execution.started_at)}</span>
        </div>
        {resultText && (
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {resultText}
          </p>
        )}
        <div className="flex items-center gap-2 pt-0.5">
          {execution.confirm_url && (
            <a
              href={execution.confirm_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <IconExternalLink className="size-3" />
              查看详情
            </a>
          )}
          {isUnread && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary"
              onClick={() => onMarkRead(execution.id)}
            >
              标记已读
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function NotificationBell() {
  const { data: notifications = [] } = useNotifications()
  const dialogOpen = useNotificationStore((s) => s.dialogOpen)
  const setDialogOpen = useNotificationStore((s) => s.setDialogOpen)
  const autoPopupDisabled = useNotificationStore(
    (s) => s.autoPopupDisabled
  )
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
  const prevReadIdsRef = React.useRef<Set<number>>(new Set())
  React.useEffect(() => {
    if (
      !autoPopupDisabled &&
      unreadCount > 0 &&
      unreadCount > prevCountRef.current
    ) {
      setDialogOpen(true)

      if (window.electronApi?.sendNotification) {
        const latest = unreadItems[unreadItems.length - 1]
        if (latest && !prevReadIdsRef.current.has(latest.id)) {
          window.electronApi.sendNotification(
            `${latest.employee_name} · ${latest.task_name}`,
            latest.run_result || "任务执行完成",
            false
          )
        }
      }
    }
    prevCountRef.current = unreadCount
    prevReadIdsRef.current = new Set(
      notifications.filter((n) => n.is_read).map((n) => n.id)
    )
  }, [unreadCount, autoPopupDisabled, setDialogOpen, unreadItems, notifications])

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
              <span className="absolute -top-0.5 -right-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground animate-pulse">
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
      <DialogContent className="flex max-h-[70vh] sm:max-w-md max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="flex flex-row items-center justify-between px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            消息通知
            {unreadCount > 0 && (
              <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">
                {unreadCount}条未读
              </Badge>
            )}
          </DialogTitle>
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
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={autoPopupDisabled}
              onChange={(e) => onAutoPopupDisabledChange(e.target.checked)}
              className="rounded border-border"
            />
            不再自动弹出通知
          </label>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

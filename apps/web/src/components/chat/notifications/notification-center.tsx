import * as React from "react"
import { IconBell, IconBellFilled, IconCheck } from "@tabler/icons-react"
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
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import {
  useNotificationStore,
  selectUnreadCount,
} from "@/stores/notification-store"
import type { ScheduledRunNotification } from "@/stores/notification-store"
import { useChatStore } from "@/stores/chat-store"
import { getContactId } from "@/lib/chat/contact-utils"
import { selectConversationForContact } from "@/lib/chat/conversation-selection"

function formatRelativeTime(ts: number): string {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
}

function openRunConversation(conversationId: number): void {
  // 切到总管联系人 + 选中本轮 curator 会话（只读会话深链）
  const state = useChatStore.getState()
  const curatorContact = state.contacts.find((c) => c.type === "curator")
  const curatorContactId = curatorContact ? getContactId(curatorContact) : null
  if (curatorContactId == null) return
  selectConversationForContact(curatorContactId, conversationId)
}

function NotificationItem({
  item,
  onSelect,
}: {
  item: ScheduledRunNotification
  onSelect: (item: ScheduledRunNotification) => void
}) {
  const isUnread = !item.read

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={cn(
        "group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
        isUnread
          ? "border-primary/20 bg-primary/[0.02]"
          : "border-border opacity-70"
      )}
    >
      <div className="flex shrink-0 pt-1.5">
        <span
          className={cn(
            "block size-2 rounded-full",
            isUnread ? "bg-blue-500" : "bg-muted-foreground/30"
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          「{item.title}」· 第{item.run_seq}轮
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatRelativeTime(item.ts)}
        </p>
      </div>
    </button>
  )
}

export function NotificationBell() {
  const unreadCount = useNotificationStore(selectUnreadCount)
  const dialogOpen = useNotificationStore((s) => s.dialogOpen)
  const setDialogOpen = useNotificationStore((s) => s.setDialogOpen)
  const autoPopupDisabled = useNotificationStore((s) => s.autoPopupDisabled)
  const setAutoPopupDisabled = useNotificationStore(
    (s) => s.setAutoPopupDisabled
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
  unreadCount,
  autoPopupDisabled,
  onAutoPopupDisabledChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  unreadCount: number
  autoPopupDisabled: boolean
  onAutoPopupDisabledChange: (disabled: boolean) => void
}) {
  const items = useNotificationStore((s) => s.items)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)

  const handleSelect = (item: ScheduledRunNotification) => {
    markRead(item.run_id)
    openRunConversation(item.conversation_id)
    onOpenChange(false)
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
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <IconBell className="size-8 stroke-1" />
              <p className="mt-2 text-sm">暂无定时任务通知</p>
            </div>
          ) : (
            items.map((item) => (
              <NotificationItem
                key={item.run_id}
                item={item}
                onSelect={handleSelect}
              />
            ))
          )}
        </div>

        <Separator />

        <DialogFooter className="px-5 py-2.5">
          <div className="flex w-full items-center justify-between">
            {unreadCount > 0 && (
              <Button variant="ghost" size="xs" onClick={() => markAllRead()}>
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

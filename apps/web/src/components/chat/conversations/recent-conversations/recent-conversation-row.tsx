import * as React from "react"
import {
  IconInfoCircle,
  IconPin,
  IconPinnedOff,
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
import { cn } from "@workspace/ui/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { CURATOR_AVATAR_URL } from "@/lib/avatar"
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "../../contacts/contact-avatars"
import { getRecentItemUnreadKey } from "./model"
import type { RecentConversationItem } from "./types"

function formatTimeAgo(date?: Date) {
  if (!date) return ""
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
}

/** SSE 运行态未读（conversation-status-store），头像角标 */
function StreamingActivityBadge({ item }: { item: RecentConversationItem }) {
  const key = getRecentItemUnreadKey(item)
  const count = useConversationStatusStore((s) => s.unreadCounts[key] ?? 0)
  if (count === 0) return null
  return (
    <span
      className="absolute -top-1 -right-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-background bg-purple-500 px-0.5 text-[10px] leading-none font-medium text-white"
      aria-label={`${count} 条新动态`}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

function PinnedIndicator({
  item,
  selectedContactId,
}: {
  item: RecentConversationItem
  selectedContactId: string | null
}) {
  if (!item.isPinned) return null
  return (
    <IconPin
      className={cn(
        "size-3.5 shrink-0",
        selectedContactId === item.contactId
          ? "text-primary-foreground/70"
          : "text-muted-foreground"
      )}
    />
  )
}

function RecentConversationContextMenu({
  item,
  onDetail,
  onTogglePin,
  onRequestRemove,
}: {
  item: RecentConversationItem
  onDetail: () => void
  onTogglePin: () => void
  onRequestRemove: () => void
}) {
  if (item.isCurator) return null

  return (
    <ContextMenuContent className="w-40">
      <ContextMenuItem onSelect={onDetail}>
        <IconInfoCircle className="text-muted-foreground" />
        <span>详情</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onTogglePin}>
        {item.isPinned ? (
          <>
            <IconPinnedOff />
            <span>取消置顶</span>
          </>
        ) : (
          <>
            <IconPin />
            <span>置顶</span>
          </>
        )}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={onRequestRemove}>
        <IconTrash />
        <span>删除会话</span>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

interface RecentConversationRowProps {
  item: RecentConversationItem
  collapsed?: boolean
  selectedContactId: string | null
  isSelected: boolean
  onSelect: (item: RecentConversationItem) => void
  onDetail: (item: RecentConversationItem) => void
  onTogglePin: (item: RecentConversationItem) => void
  onRemove: (item: RecentConversationItem) => void | Promise<void>
  isRemoving?: boolean
}

export function RecentConversationRow({
  item,
  collapsed,
  selectedContactId,
  isSelected,
  onSelect,
  onDetail,
  onTogglePin,
  onRemove,
  isRemoving = false,
}: RecentConversationRowProps) {
  const [alertOpen, setAlertOpen] = React.useState(false)

  const handleDeleteConfirm = () => {
    setAlertOpen(false)
    void onRemove(item)
  }

  return (
    <>
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          title={collapsed ? item.contactName : undefined}
          className={cn(
            "group flex cursor-pointer items-center transition-colors",
            collapsed
              ? "justify-center rounded-lg px-0 py-2"
              : "gap-3 rounded-md px-3 py-2.5 text-xs",
            isSelected
              ? "bg-primary/90 text-primary-foreground"
              : "hover:bg-accent/50 hover:text-accent-foreground"
          )}
          onClick={() => {
            if (!isRemoving) onSelect(item)
          }}
          aria-busy={isRemoving}
        >
          <div className="relative shrink-0">
            {item.isGroup ? (
              <GroupMembersAvatar
                participants={item.participants?.map((p) => ({
                  id: p.name,
                  name: p.name,
                  role: "",
                  status: "online" as const,
                  specialty: "",
                  avatar: p.avatar,
                }))}
                className={cn("size-9", collapsed && "size-8")}
              />
            ) : (
              <EmployeeContactAvatar
                name={item.contactName}
                avatar={item.isCurator ? CURATOR_AVATAR_URL : item.avatar}
                status={item.status as "online" | "busy" | "offline"}
                showStatus
                avatarClassName={collapsed ? "size-8" : undefined}
                statusClassName={collapsed ? "h-2 w-2" : undefined}
              />
            )}
            <StreamingActivityBadge item={item} />
          </div>
          {!collapsed && (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  {item.isCurator && (
                    <IconPin
                      className={cn(
                        "size-3.5",
                        selectedContactId === item.contactId
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      )}
                    />
                  )}
                  {!item.isCurator && (
                    <PinnedIndicator
                      item={item}
                      selectedContactId={selectedContactId}
                    />
                  )}
                  <span className="w-26 truncate text-sm font-medium">
                    {item.contactName}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      selectedContactId === item.contactId
                        ? "text-primary-foreground/70"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatTimeAgo(item.updatedAt)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "max-w-[160px] truncate",
                    selectedContactId === item.contactId
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground"
                  )}
                >
                  {item.title || "新对话"}
                </span>
                {item.unreadCount > 0 &&
                  selectedContactId !== item.contactId && (
                    <span
                      className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
                      aria-label={`${item.unreadCount} 条未读消息`}
                    >
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </span>
                  )}
              </div>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <RecentConversationContextMenu
        item={item}
        onDetail={() => onDetail(item)}
        onTogglePin={() => onTogglePin(item)}
        onRequestRemove={() => setAlertOpen(true)}
      />
    </ContextMenu>
    <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除全部会话</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除与「{item.contactName}」的全部聊天记录吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRemoving}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={isRemoving}
            onClick={handleDeleteConfirm}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

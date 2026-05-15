import {
  IconInfoCircle,
  IconPin,
  IconPinnedOff,
  IconTrash,
} from "@tabler/icons-react"
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
import { useConversationStatusStore } from "@/stores/conversation-status-store"
import {
  EmployeeContactAvatar,
  GroupMembersAvatar,
} from "../../contacts/contact-avatars"
import type { RecentConversationItem } from "./types"

function formatTimeAgo(date?: Date) {
  if (!date) return ""
  return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
}

function ConversationStatusBadge({ item }: { item: RecentConversationItem }) {
  const targetType = item.isCurator
    ? "curator"
    : item.isGroup
      ? "group"
      : "employee"
  const targetId = item.isCurator ? 1 : Number(item.contactId)
  const key = `${targetType}:${targetId}`
  const count = useConversationStatusStore((s) => s.counts[key] ?? 0)
  if (count === 0) return null
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-purple-500 text-[10px] text-white">
      {count}
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
  onRemove,
}: {
  item: RecentConversationItem
  onDetail: () => void
  onTogglePin: () => void
  onRemove: () => void
}) {
  if (item.isCurator) return null

  return (
    <ContextMenuContent className="w-36">
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
      <ContextMenuItem variant="destructive" onSelect={onRemove}>
        <IconTrash />
        <span>移除</span>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

interface RecentConversationRowProps {
  item: RecentConversationItem
  collapsed?: boolean
  selectedContactId: string | null
  isSelected: boolean
  onSelect: (contactId: string) => void
  onDetail: (item: RecentConversationItem) => void
  onTogglePin: (item: RecentConversationItem) => void
  onRemove: (item: RecentConversationItem) => void
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
}: RecentConversationRowProps) {
  return (
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
          onClick={() => onSelect(item.contactId)}
        >
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
              avatar={item.avatar}
              status={item.status as "online" | "busy" | "offline"}
              showStatus
            />
          )}
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
                  <ConversationStatusBadge item={item} />
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
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                      {item.unreadCount}
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
        onRemove={() => onRemove(item)}
      />
    </ContextMenu>
  )
}

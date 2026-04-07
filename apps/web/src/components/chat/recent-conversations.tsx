import * as React from "react"
import { IconCirclePlus, IconSearch } from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import { findContactInList } from "@/lib/mock-data/ai-employees"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ConversationItem } from "./conversation-item"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { Conversation } from "@/lib/mock-data/conversations"

interface RecentConversationItem {
  id: string
  contactId: string
  contactName: string
  title: string
  lastMessage?: string
  lastMessageTime?: Date
  unreadCount: number
  updatedAt: Date
  avatar?: string
  status?: string
  isGroup?: boolean
  participants?: { name: string; avatar?: string }[]
}

const RECENT_CONVERSATIONS_KEY = "app:recent-conversations"
const MAX_RECENT = 50

function loadRecentConversations(): RecentConversationItem[] {
  try {
    const raw = localStorage.getItem(RECENT_CONVERSATIONS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((item: Record<string, unknown>) => ({
      ...item,
      lastMessageTime: item.lastMessageTime
        ? new Date(item.lastMessageTime as string)
        : undefined,
      updatedAt: new Date(item.updatedAt as string),
    }))
  } catch {
    return []
  }
}

function saveRecentConversations(items: RecentConversationItem[]) {
  try {
    localStorage.setItem(RECENT_CONVERSATIONS_KEY, JSON.stringify(items))
  } catch {
    // ignore storage errors
  }
}

function upsertRecentConversation(
  existing: RecentConversationItem[],
  conv: Conversation,
  contact: { id: string; name: string; avatar?: string; status?: string } | null,
  isGroup = false,
  participants?: { name: string; avatar?: string }[]
): RecentConversationItem[] {
  const item: RecentConversationItem = {
    id: conv.id,
    contactId: conv.contactId,
    contactName: contact?.name ?? "未知",
    title: conv.title,
    lastMessage: conv.lastMessage,
    lastMessageTime: conv.lastMessageTime,
    unreadCount: conv.unreadCount,
    updatedAt: conv.updatedAt,
    avatar: contact?.avatar,
    status: contact?.status,
    isGroup,
    participants,
  }
  const filtered = existing.filter((c) => c.id !== conv.id)
  return [item, ...filtered].slice(0, MAX_RECENT)
}

function getContactInfoFromStore(
  contactId: string
): {
  id: string
  name: string
  avatar?: string
  status?: string
} | null {
  const contacts = useChatStore.getState().contacts
  const contact = findContactInList(contacts, contactId)
  if (!contact) return null
  if (contact.type === "curator") {
    return {
      id: contact.curator!.id,
      name: contact.curator!.name,
      avatar: contact.curator!.avatar,
      status: contact.curator!.status,
    }
  }
  if (contact.type === "employee") {
    return {
      id: contact.employee!.id,
      name: contact.employee!.name,
      avatar: contact.employee!.avatar,
      status: contact.employee!.status,
    }
  }
  if (contact.type === "group") {
    return {
      id: contact.group!.id,
      name: contact.group!.name,
    }
  }
  return null
}

export function RecentConversations({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [recentItems, setRecentItems] = React.useState<RecentConversationItem[]>(
    loadRecentConversations
  )

  const {
    selectedContactId,
    selectedConversationId,
    isDraftConversation,
    setDraftConversation,
    setSelectedConversationId,
    setSelectedContactId,
  } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
      isDraftConversation: state.isDraftConversation,
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
      setSelectedContactId: state.setSelectedContactId,
    }))
  )

  const selectedContact = useChatStore((s) => s.getSelectedContact())

  const { data: conversations = [] } = useConversationsQuery(
    selectedContactId,
    selectedContact
  )

  React.useEffect(() => {
    if (!selectedContact || selectedContact.type === "curator") return
    const contactInfo = getContactInfoFromStore(selectedContactId ?? "")
    const isGroup = selectedContact.type === "group"
    const participants = isGroup
      ? selectedContact.group?.participants.map((p) => ({
          name: p.name,
          avatar: p.avatar,
        }))
      : undefined

    const updated = conversations.reduce(
      (acc, conv) =>
        upsertRecentConversation(acc, conv, contactInfo, isGroup, participants),
      recentItems
    )
    const hasNew = updated.length !== recentItems.length || updated[0]?.id !== recentItems[0]?.id
    if (hasNew) {
      setRecentItems(updated)
      saveRecentConversations(updated)
    }
  }, [conversations, selectedContact, selectedContactId])

  const handleSelectConversation = (conversationId: string) => {
    const item = recentItems.find((c) => c.id === conversationId)
    if (item) {
      setSelectedContactId(item.contactId)
    }
    setDraftConversation(false)
    setSelectedConversationId(conversationId)
  }

  const handleNewConversation = () => {
    setDraftConversation(true)
    setSelectedConversationId(null)
  }

  const getTimeAgo = (date?: Date) => {
    if (!date) return ""
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
  }

  const displayItems = conversations.length > 0 ? recentItems : []

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col border-r bg-muted/50 transition-all duration-300",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">聊天</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" className="h-8 w-8" title="搜索">
            <IconSearch className="size-4" />
          </Button>
        </div>
      </div>

      <div className="px-2 pt-2 pb-1">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewConversation}
        >
          <IconCirclePlus className="size-4" />
          新建会话
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {displayItems.map((item) => (
            <div
              key={item.id}
              className={cn(
                "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-xs transition-colors",
                selectedConversationId === item.id ||
                  (isDraftConversation && selectedContactId === item.contactId)
                  ? "bg-accent text-primary"
                  : "hover:bg-accent/50 hover:text-accent-foreground"
              )}
              onClick={() => handleSelectConversation(item.id)}
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
                  className="size-9"
                />
              ) : (
                <EmployeeContactAvatar
                  name={item.contactName}
                  avatar={item.avatar}
                  status={item.status as "online" | "busy" | "offline"}
                  showStatus
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-center justify-between">
                  <span className="truncate text-sm font-medium">{item.contactName}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {getTimeAgo(item.updatedAt)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="max-w-[160px] truncate text-muted-foreground">
                    {item.title}
                  </span>
                  {item.unreadCount > 0 && (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                      {item.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          {displayItems.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <IconCirclePlus className="size-8 stroke-1" />
              <p className="mt-2 text-xs">暂无会话记录</p>
              <p className="text-xs">选择联系人开始聊天</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

import * as React from "react"
import {
  IconCirclePlus,
  IconSearch,
  IconUsers,
  IconUserPlus,
} from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useConversationsQuery } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import {
  findContactInList,
  type AIEmployee,
} from "@/lib/mock-data/ai-employees"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { CreateGroupDialog } from "./create-group-dialog"
import { RecruitEmployeeDialog } from "./recruit-employee-dialog"
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
  updatedAt?: Date
  avatar?: string
  status?: string
  isGroup?: boolean
  isDraft?: boolean
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
      updatedAt: item.updatedAt
        ? new Date(item.updatedAt as string)
        : undefined,
    })) as RecentConversationItem[]
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
  contact: {
    id: string
    name: string
    avatar?: string
    status?: string
  } | null,
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
    updatedAt: conv.updatedAt ?? undefined,
    avatar: contact?.avatar,
    status: contact?.status,
    isGroup,
    participants,
  }
  const filtered = existing.filter((c) => c.id !== conv.id)
  return [item, ...filtered].slice(0, MAX_RECENT)
}

function getContactInfoFromStore(contactId: string): {
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
  const [recentItems, setRecentItems] = React.useState<
    RecentConversationItem[]
  >(loadRecentConversations)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [isRecruitDialogOpen, setIsRecruitDialogOpen] = React.useState(false)

  const {
    selectedContactId,
    selectedConversationId,
    isDraftConversation,
    setDraftConversation,
    setSelectedConversationId,
    setSelectedContactId,
    startDraftConversation: startDraft,
  } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
      isDraftConversation: state.isDraftConversation,
      setDraftConversation: state.setDraftConversation,
      setSelectedConversationId: state.setSelectedConversationId,
      setSelectedContactId: state.setSelectedContactId,
      startDraftConversation: state.startDraftConversation,
    }))
  )

  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const contacts = useChatStore((s) => s.contacts)

  const employeeList = React.useMemo(
    () =>
      contacts
        .filter((c) => c.type === "employee")
        .map((c) => c.employee)
        .filter(Boolean) as AIEmployee[],
    [contacts]
  )

  const handleCreateGroup = (selectedEmployees: AIEmployee[]) => {
    console.log("创建群聊，选择员工:", selectedEmployees)
    setIsDialogOpen(false)
  }

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
    const hasNew =
      updated.length !== recentItems.length ||
      updated[0]?.id !== recentItems[0]?.id
    if (hasNew) {
      setRecentItems(updated)
      saveRecentConversations(updated)
    }
  }, [conversations, selectedContact, selectedContactId])

  React.useEffect(() => {
    if (!isDraftConversation || !selectedContactId) return
    const hasExisting = recentItems.some(
      (item) => item.contactId === selectedContactId && !item.isDraft
    )
    if (hasExisting) return
    const contactInfo = getContactInfoFromStore(selectedContactId)
    const existingDraft = recentItems.find(
      (item) => item.isDraft && item.contactId === selectedContactId
    )
    if (existingDraft) return
    const draftItem: RecentConversationItem = {
      id: `draft:${selectedContactId}`,
      contactId: selectedContactId,
      contactName: contactInfo?.name ?? "未知",
      title: "",
      unreadCount: 0,
      avatar: contactInfo?.avatar,
      status: contactInfo?.status,
      isDraft: true,
    }
    const updated = [draftItem, ...recentItems].slice(0, MAX_RECENT)
    setRecentItems(updated)
    saveRecentConversations(updated)
  }, [isDraftConversation, selectedContactId])

  const handleSelectConversation = (conversationId: string) => {
    const item = recentItems.find((c) => c.id === conversationId)
    if (!item) return
    if (item.isDraft) {
      startDraft(item.contactId)
      return
    }
    setSelectedContactId(item.contactId)
    setDraftConversation(false)
    setSelectedConversationId(conversationId)
  }

  const getTimeAgo = (date?: Date) => {
    if (!date) return ""
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
  }

  const displayItems = React.useMemo(() => {
    const items =
      conversations.length > 0
        ? recentItems
        : recentItems.filter((item) => item.isDraft)
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter(
      (item) =>
        item.contactName.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.lastMessage?.toLowerCase().includes(q)
    )
  }, [conversations, recentItems, searchQuery])

  return (
    <>
      <CreateGroupDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        employees={employeeList}
        onCreate={handleCreateGroup}
      />
      <RecruitEmployeeDialog
        open={isRecruitDialogOpen}
        onOpenChange={setIsRecruitDialogOpen}
      />
      <div
        className={cn(
          "flex h-full w-full flex-col border-r bg-muted/50 transition-all duration-300",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-1.5 border-b px-3 py-2">
          <div className="relative flex-1">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 border-none bg-background pl-7 text-xs"
              placeholder="搜索会话..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-7 w-7 shrink-0"
              >
                <IconCirclePlus className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
                <IconUsers className="size-4" />
                添加群聊
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsRecruitDialogOpen(true)}>
                <IconUserPlus className="size-4" />
                招聘员工
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {displayItems.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-xs transition-colors",
                  (item.isDraft &&
                    isDraftConversation &&
                    selectedContactId === item.contactId) ||
                    (!item.isDraft && selectedConversationId === item.id)
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
                    <span className="truncate text-sm font-medium">
                      {item.contactName}
                    </span>
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
    </>
  )
}

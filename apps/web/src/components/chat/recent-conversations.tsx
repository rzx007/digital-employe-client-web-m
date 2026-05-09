import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  IconCirclePlus,
  IconInfoCircle,
  IconPin,
  IconPinnedOff,
  IconSearch,
  IconTrash,
  IconUsers,
  IconUserPlus,
} from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@workspace/ui/components/context-menu"
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
import {
  findContactInList,
  PRIMARY_CURATOR,
  type AIEmployee,
  type Contact,
} from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { CreateGroupDialog } from "./create-group-dialog"
import { GroupDetailDialog } from "./group-detail-dialog"
import { EmployeeDetailDialog } from "../employee/employee-detail-dialog"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import type { Conversation } from "@/lib/mock-data/conversations"

function getCuratorContactId(): string {
  const contacts = useChatStore.getState().contacts
  const curator = contacts.find((c) => c.type === "curator")
  return curator?.curator?.id ?? PRIMARY_CURATOR.id
}

function getCuratorDisplay() {
  const contacts = useChatStore.getState().contacts
  const curator = contacts.find((c) => c.type === "curator")?.curator
  return {
    name: curator?.name ?? PRIMARY_CURATOR.name,
    avatar: curator?.avatar ?? PRIMARY_CURATOR.avatar,
    status: curator?.status ?? PRIMARY_CURATOR.status,
  }
}

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
  isCurator?: boolean
  isPinned?: boolean
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
    return (parsed as RecentConversationItem[]).map((item) => ({
      ...item,
      lastMessageTime: item.lastMessageTime
        ? new Date(item.lastMessageTime as unknown as string)
        : undefined,
      updatedAt: item.updatedAt
        ? new Date(item.updatedAt as unknown as string)
        : undefined,
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
  contact: {
    id: string
    name: string
    avatar?: string
    status?: string
  } | null,
  isGroup = false,
  participants?: { name: string; avatar?: string }[]
): RecentConversationItem[] {
  const existingItem = existing.find((c) => c.contactId === conv.contactId)
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
    isCurator: conv.contactId === getCuratorContactId(),
    isPinned: existingItem?.isPinned,
    participants,
  }
  const filtered = existing.filter((c) => c.contactId !== conv.contactId)
  const updated = [item, ...filtered].slice(0, MAX_RECENT)
  if (item.isCurator) {
    const withoutCurator = updated.filter((c) => !c.isCurator)
    return [item, ...withoutCurator]
  }
  return updated
}

function ensureContactInList(
  existing: RecentConversationItem[],
  contactId: string
): RecentConversationItem[] {
  const exists = existing.some((c) => c.contactId === contactId)
  if (exists) {
    const filtered = existing.filter((c) => c.contactId !== contactId)
    const item = existing.find((c) => c.contactId === contactId)!
    return [item, ...filtered]
  }
  const contactInfo = getContactInfoFromStore(contactId)
  if (!contactInfo) return existing
  const contact = findContactInList(useChatStore.getState().contacts, contactId)
  const isGroup = contact?.type === "group"
  const isCurator =
    contact?.type === "curator" || contactId === getCuratorContactId()
  const newItem: RecentConversationItem = {
    id: `recent:${contactId}`,
    contactId,
    contactName: contactInfo.name,
    title: isCurator ? "数字员工统筹" : "",
    unreadCount: 0,
    updatedAt: new Date(),
    avatar: contactInfo.avatar,
    status: contactInfo.status,
    isGroup,
    isCurator,
    participants: isGroup
      ? contact.group?.participants.map((p) => ({
        name: p.name,
        avatar: p.avatar,
      }))
      : undefined,
  }
  return [newItem, ...existing].slice(0, MAX_RECENT)
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
  collapsed,
  ...props
}: React.ComponentProps<"div"> & { collapsed?: boolean }) {
  const [recentItems, setRecentItems] = React.useState<
    RecentConversationItem[]
  >(() => {
    const loaded = loadRecentConversations()
    // 移除 历史静态会话 curator-primary
    const cleaned = loaded.filter((c) => c.id !== `recent:curator-primary`)
    const curatorId = getCuratorContactId()
    const hasCurator = cleaned.some((c) => c.contactId === curatorId)
    if (hasCurator) return cleaned
    const curatorDisplay = getCuratorDisplay()
    const curatorItem: RecentConversationItem = {
      id: `recent:${curatorId}`,
      contactId: curatorId,
      contactName: curatorDisplay.name,
      title: "数字员工统筹",
      unreadCount: 0,
      updatedAt: new Date(),
      avatar: curatorDisplay.avatar,
      status: curatorDisplay.status,
      isCurator: true,
    }
    const items = [curatorItem, ...cleaned]
    saveRecentConversations(items)
    return items
  })
  const navigate = useNavigate()

  const [searchQuery, setSearchQuery] = React.useState("")
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [detailContact, setDetailContact] = React.useState<Contact | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const { selectedContactId, isDraftConversation, switchToContact } =
    useChatStore(
      useShallow((state) => ({
        selectedContactId: state.selectedContactId,
        selectedConversationId: state.selectedConversationId,
        isDraftConversation: state.isDraftConversation,
        switchToContact: state.switchToContact,
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
    if (conversations.length === 0) return
    const contactInfo = getContactInfoFromStore(selectedContactId ?? "")
    const isGroup = selectedContact.type === "group"
    const participants = isGroup
      ? selectedContact.group?.participants.map((p) => ({
        name: p.name,
        avatar: p.avatar,
      }))
      : undefined

    setRecentItems((prev) => {
      const updated = conversations.reduce(
        (acc, conv) =>
          upsertRecentConversation(
            acc,
            conv,
            contactInfo,
            isGroup,
            participants
          ),
        prev
      )
      const hasNew =
        updated.length !== prev.length ||
        updated[0]?.id !== prev[0]?.id ||
        updated[0]?.updatedAt?.getTime() !== prev[0]?.updatedAt?.getTime()
      if (hasNew) {
        saveRecentConversations(updated)
        return updated
      }
      return prev
    })
  }, [conversations, selectedContact, selectedContactId])

  React.useEffect(() => {
    if (!selectedContactId) return
    setRecentItems((prev) => {
      const exists = prev.some((c) => c.contactId === selectedContactId)
      if (exists) return prev
      const updated = ensureContactInList(prev, selectedContactId)
      saveRecentConversations(updated)
      return updated
    })
  }, [selectedContactId])

  React.useEffect(() => {
    if (isDraftConversation) return
    if (!selectedContactId) return
    const draftItem = recentItems.find(
      (item) => item.isDraft && item.contactId === selectedContactId
    )
    if (!draftItem) return
    setRecentItems((prev) => {
      const updated = prev.filter(
        (item) => !(item.isDraft && item.contactId === selectedContactId)
      )
      saveRecentConversations(updated)
      return updated
    })
  }, [isDraftConversation, recentItems, selectedContactId])

  const handleSelectItem = (contactId: string) => {
    if (contactId === selectedContactId) return
    switchToContact(contactId)
  }

  const handleDetail = (item: RecentConversationItem) => {
    const contact = findContactInList(contacts, item.contactId)
    if (contact) {
      setDetailContact(contact)
      setDetailOpen(true)
    }
  }

  const handleTogglePin = (item: RecentConversationItem) => {
    setRecentItems((prev) => {
      const updated = prev.map((i) =>
        i.contactId === item.contactId ? { ...i, isPinned: !i.isPinned } : i
      )
      saveRecentConversations(updated)
      return updated
    })
  }

  const handleRemove = (item: RecentConversationItem) => {
    setRecentItems((prev) => {
      const updated = prev.filter((i) => i.contactId !== item.contactId)
      saveRecentConversations(updated)
      return updated
    })
  }

  const getTimeAgo = (date?: Date) => {
    if (!date) return ""
    return formatDistanceToNow(date, { addSuffix: true, locale: zhCN })
  }

  const displayItems = React.useMemo(() => {
    let items = recentItems
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      items = items.filter(
        (item) =>
          item.contactName.toLowerCase().includes(q) ||
          item.title.toLowerCase().includes(q)
      )
    }
    return [...items].sort((a, b) => {
      if (a.isCurator && !b.isCurator) return -1
      if (!a.isCurator && b.isCurator) return 1
      if (a.isPinned && !b.isPinned) return -1
      if (!a.isPinned && b.isPinned) return 1
      const ta = a.updatedAt?.getTime() ?? 0
      const tb = b.updatedAt?.getTime() ?? 0
      return tb - ta
    })
  }, [recentItems, searchQuery])

  const renderDetailDialog = () => {
    if (!detailContact) return null
    if (detailContact.type === "employee") {
      return (
        <EmployeeDetailDialog
          contact={detailContact}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )
    }
    if (detailContact.type === "group") {
      return (
        <GroupDetailDialog
          contact={detailContact}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )
    }
    return null
  }

  const renderPinIcon = (item: RecentConversationItem) => {
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

  const renderContextMenuItem = (item: RecentConversationItem) => {
    if (item.isCurator) return null

    return (
      <ContextMenuContent className="w-36">
        <ContextMenuItem onSelect={() => handleDetail(item)}>
          <IconInfoCircle className="text-muted-foreground" />
          <span>详情</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => handleTogglePin(item)}>
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
        <ContextMenuItem
          variant="destructive"
          onSelect={() => handleRemove(item)}
        >
          <IconTrash />
          <span>移除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  const isSelected = (item: RecentConversationItem) =>
    (item.isDraft && isDraftConversation && selectedContactId === item.contactId) ||
    (!item.isDraft && selectedContactId === item.contactId)

  return (
    <>
      <CreateGroupDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        employees={employeeList}
        onCreate={handleCreateGroup}
      />
      {renderDetailDialog()}
      <div
        className={cn(
          "flex h-full min-h-0 w-full flex-col border-r bg-muted/50 transition-all duration-300",
          collapsed && "items-center",
          className
        )}
        {...props}
      >
        {!collapsed && (
          <div className="flex items-center gap-1.5 border-b px-3 py-4">
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
                  data-tour-id="add-button"
                >
                  <IconCirclePlus className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={async () => {
                    if (window.electronApi?.openRecruitment) {
                      await window.electronApi.openRecruitment()
                    } else {
                      navigate({ to: "/recruitment" })
                    }
                  }}
                >
                  <IconUserPlus className="size-4" />
                  招聘员工
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setIsDialogOpen(true)}>
                  <IconUsers className="size-5" />
                  添加群聊
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 w-full">
          <div className={cn("py-2 px-1", collapsed && "px-1.5")}>
            {displayItems.map((item) => (
              <React.Fragment key={item.contactId}>
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div
                      title={collapsed ? item.contactName : undefined}
                      className={cn(
                        "group flex cursor-pointer items-center transition-colors",
                        collapsed
                          ? "justify-center rounded-lg px-0 py-2"
                          : "gap-3 rounded-md px-3 py-2.5 text-xs",
                        isSelected(item)
                          ? "bg-primary/90 text-primary-foreground"
                          : "hover:bg-accent/50 hover:text-accent-foreground"
                      )}
                      onClick={() => handleSelectItem(item.contactId)}
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
                              {!item.isCurator && renderPinIcon(item)}
                              <span className="w-26 truncate text-sm font-medium">
                                {item.contactName}
                              </span>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 text-[10px]",
                                selectedContactId === item.contactId
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              )}
                            >
                              {getTimeAgo(item.updatedAt)}
                            </span>
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
                  {renderContextMenuItem(item)}
                </ContextMenu>
                {!collapsed && <div className="mx-3 border-b"></div>}
              </React.Fragment>
            ))}
            {displayItems.length === 0 && !collapsed && (
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

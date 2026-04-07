import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import {
  IconCalendar,
  IconArchive,
  IconLayoutDashboard,
  IconMessage2Plus,
  IconDots,
  IconHistory,
  IconPencil,
  IconTrash,
  IconUsers,
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
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"

import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"
import { cn } from "@workspace/ui/lib/utils"
import { Separator } from "@workspace/ui/components/separator"
import type { ChatViewContact } from "./chat-view-shared"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"

interface ChatPanelHeaderProps {
  title: string
  conversationId?: string | number
  contact?: ChatViewContact
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
  showWorkbench?: boolean
  onToggleWorkbench?: () => void
}

export function ChatPanelHeader({
  title,
  conversationId,
  contact,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  showWorkbench,
  onToggleWorkbench,
}: ChatPanelHeaderProps) {
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const { selectedContactId, setSelectedConversationId, setDraftConversation } =
    useChatStore(
      useShallow((state) => ({
        selectedContactId: state.selectedContactId,
        setSelectedConversationId: state.setSelectedConversationId,
        setDraftConversation: state.setDraftConversation,
      }))
    )
  const deleteMutation = useDeleteConversationMutation()
  const openMonitor = useMonitorStore((s) => s.openMonitor)

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    if (!selectedContactId || !conversationId) return

    deleteMutation.mutate(
      {
        conversationId: String(conversationId),
        contactId: selectedContactId,
      },
      {
        onSuccess: () => {
          toast.success(`已删除「${title}」`)
          setSelectedConversationId(null)
          setDraftConversation(true)
        },
        onError: () => {
          toast.error("删除失败，请稍后重试")
        },
      }
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          {isMobile && (
            <>
              {onOpenContacts && (
                <Button variant="ghost" size="icon-sm" onClick={onOpenContacts}>
                  <IconUsers className="size-4" />
                </Button>
              )}
            </>
          )}
          {contact && (
            <>
              {contact.type === "group" ? (
                <GroupMembersAvatar
                  participants={contact.group?.participants}
                  className="h-8 w-8"
                />
              ) : contact.type === "curator" ? (
                <EmployeeContactAvatar
                  name={contact.curator?.name}
                  avatar={contact.curator?.avatar}
                  status={contact.curator?.status}
                  showStatus
                />
              ) : (
                <EmployeeContactAvatar
                  name={contact.employee?.name}
                  avatar={contact.employee?.avatar}
                  status={contact.employee?.status}
                  showStatus
                />
              )}
              <Separator orientation="vertical" className="h-5 self-center" />
            </>
          )}
          <h3
            className="max-w-[200px] min-w-0 flex-1 truncate text-sm font-medium"
            title={title}
          >
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-1">
          {onNewConversation && (
            <Button
              title="新建对话"
              variant="ghost"
              size="icon-sm"
              onClick={onNewConversation}
            >
              <IconMessage2Plus className="size-4" />
            </Button>
          )}
          {onOpenConversations && (
            <Button
              title="历史话列表"
              variant="ghost"
              size="icon-sm"
              onClick={onOpenConversations}
            >
              <IconHistory className="size-4" />
            </Button>
          )}
          {contact?.type === "employee" && (
            <Button
              title="监控"
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                openMonitor(
                  contact.employee?.id ?? "",
                  contact.employee?.name ?? ""
                )
              }
            >
              <IconCalendar className="size-4" />
            </Button>
          )}
          {contact?.type === "employee" && (
            <Button
              title="工作台"
              variant={showWorkbench ? "secondary" : "ghost"}
              size="icon-sm"
              onClick={onToggleWorkbench}
            >
              <IconLayoutDashboard className="size-4" />
            </Button>
          )}
          {
            conversationId && (
              <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm">
                    <IconDots className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-36">
                  <DropdownMenuItem>
                    <IconPencil className="text-muted-foreground" />
                    <span>重命名</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <IconArchive className="text-muted-foreground" />
                    <span>归档</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={handleDeleteClick}
                  >
                    <IconTrash />
                    <span>删除</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          }
        </div >
      </div >

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{title}」吗？删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDeleteConfirm}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

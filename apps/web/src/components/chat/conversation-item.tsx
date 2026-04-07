import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import {
  IconArchive,
  IconDots,
  IconPencil,
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
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useDeleteConversationMutation } from "@/hooks/use-chat-queries"
import { useChatStore } from "@/stores/chat-store"
import type { Conversation } from "@/lib/mock-data/conversations"
import { Spinner } from "@/components/spinner"

interface ConversationItemProps extends React.ComponentProps<"div"> {
  conversation: Conversation
  isSelected: boolean
}

export function ConversationItem({
  conversation,
  isSelected,
  className,
  ...props
}: ConversationItemProps) {
  const {
    selectedContactId,
    selectedConversationId,
    setSelectedConversationId,
    setDraftConversation,
  } = useChatStore(
    useShallow((state) => ({
      selectedContactId: state.selectedContactId,
      selectedConversationId: state.selectedConversationId,
      setSelectedConversationId: state.setSelectedConversationId,
      setDraftConversation: state.setDraftConversation,
    }))
  )
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [alertOpen, setAlertOpen] = React.useState(false)
  const deleteMutation = useDeleteConversationMutation()

  const getTimeAgo = (date?: Date) => {
    if (!date) return ""
    return formatDistanceToNow(date, {
      addSuffix: true,
      locale: zhCN,
    })
  }

  const renderStatusIndicator = () => {
    if (conversation.status === "running") {
      return (
        <Spinner
          className="size-3.5 text-purple-500"
          style={{ color: "#8B5CF6" }}
        />
      )
    }
    if (conversation.status === "error") {
      return <div className="size-1.5 rounded-full bg-destructive" />
    }
    if (conversation.status === "unread") {
      return <div className="size-1.5 rounded-full bg-primary" />
    }
    return <span className="text-natural-500">-</span>
  }

  const handleDeleteClick = () => {
    setMenuOpen(false)
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    if (!selectedContactId) return

    deleteMutation.mutate(
      {
        conversationId: conversation.id,
        contactId: selectedContactId,
      },
      {
        onSuccess: () => {
          toast.success(`已删除「${conversation.title}」`)

          if (selectedConversationId === conversation.id) {
            setSelectedConversationId(null)
            setDraftConversation(true)
          }
        },
        onError: () => {
          toast.error("删除失败，请稍后重试")
        },
      }
    )
  }

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-md px-3 py-2.5 text-xs transition-colors",
          isSelected
            ? "bg-accent text-primary"
            : "hover:bg-accent/50 hover:text-accent-foreground",
          className
        )}
        {...props}
      >
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          {renderStatusIndicator()}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="relative flex items-center justify-between">
            <span className="truncate text-sm font-medium max-w-56">
              {conversation.title}
            </span>
            <span
              className={cn(
                "text-natural-500 shrink-0 text-[10px] transition-opacity group-hover:opacity-0",
                menuOpen && "opacity-0"
              )}
            >
              {getTimeAgo(conversation.updatedAt)}
            </span>
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "absolute right-0 h-6 w-6 rounded-sm opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                  )}
                  onClick={(event) => event.stopPropagation()}
                >
                  <IconDots className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-36"
                onClick={(event) => event.stopPropagation()}
              >
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
          </div>
        </div>
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除「{conversation.title}」吗？删除后不可恢复。
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

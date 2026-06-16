import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { useQueryClient } from "@tanstack/react-query"

import { IconInfoCircle, IconRefresh, IconTrash } from "@tabler/icons-react"
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
import type { Contact } from "@/types/chat"
import { useAuthStore } from "@/stores/auth-store"
import { useChatStore } from "@/stores/chat-store"
import { chatKeys } from "@/lib/query-keys/chat"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import { deleteEmployee } from "@/api/employee"
import { resetChatRightPanels } from "@/lib/chat/reset-chat-right-panels"
import {
  clearSelectedContact,
  selectContactForDetail,
  switchToContact,
} from "@/lib/chat/conversation-selection"
import { deleteRecentContact } from "@/api/recent-contacts"
import { mapContactToTarget } from "@/lib/chat/contact-target"
import { getContactId } from "@/lib/chat/contact-utils"

import { EmployeeContactAvatar } from "./contact-avatars"
import { EmployeeDetailDialog } from "@/components/employee/employee-detail-dialog"

interface ContactItemProps extends React.ComponentProps<"div"> {
  contact: Contact
  isCollapsed: boolean
  /** select：仅选中（联系人 Tab）；openChat：进入对话（默认） */
  clickAction?: "select" | "openChat"
  onDoubleClick?: () => void
}

export function ContactItem({
  contact,
  isCollapsed,
  clickAction = "openChat",
  onDoubleClick,
  className,
  ...props
}: ContactItemProps) {
  const workspaceId = useAuthStore((s) => s.workspaceId) ?? getActiveWorkspaceId()
  const { contacts, selectedContactId, setContacts } = useChatStore(
    useShallow((state) => ({
      contacts: state.contacts,
      selectedContactId: state.selectedContactId,
      setContacts: state.setContacts,
    }))
  )
  // 选择标识：带 type 前缀，避免群与员工同 id 串号
  const contactId = getContactId(contact)
  // 原始主键：用于删除等需要真实 id 的后端操作
  const rawId =
    contact.type === "curator"
      ? contact.curator?.id
      : contact.employee?.id
  const isSelected = selectedContactId === contactId

  const [alertOpen, setAlertOpen] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const queryClient = useQueryClient()

  const displayName =
    contact.type === "curator" ? contact.curator?.name : contact.employee?.name

  const handleClick = () => {
    if (!contactId) return
    if (clickAction === "select") {
      selectContactForDetail(contactId)
      return
    }
    switchToContact(contactId)
  }

  const handleDetail = () => {
    setDetailOpen(true)
  }

  const handleDeleteClick = () => {
    setAlertOpen(true)
  }

  const focusAfterContactRemoved = (removedContactId: string) => {
    if (selectedContactId !== removedContactId) return
    clearSelectedContact()
    resetChatRightPanels()
  }

  const handleDeleteConfirm = async () => {
    setAlertOpen(false)

    if (contact.type === "employee" && rawId) {
      try {
        await deleteEmployee(rawId)
        const target = mapContactToTarget(contact)
        if (target) {
          void deleteRecentContact(target.target_type, target.target_id, {
            workspaceId,
          })
          void queryClient.invalidateQueries({
            queryKey: chatKeys.recentContacts(workspaceId),
          })
        }
        setContacts(
          contacts.filter(
            (c) => !(c.type === "employee" && c.employee?.id === rawId)
          )
        )
        await queryClient.invalidateQueries({
          queryKey: chatKeys.contacts(),
        })
        queryClient.removeQueries({
          queryKey: chatKeys.conversations(contactId),
        })
        focusAfterContactRemoved(contactId)
        toast.success(`已删除「${displayName}」`)
      } catch {
        toast.error("删除失败，请稍后重试")
      }
    }
  }

  const renderAvatar = () => {
    const data = contact.type === "curator" ? contact.curator : contact.employee

    return (
      <EmployeeContactAvatar
        name={data?.name}
        avatar={data?.avatar}
        status={data?.status}
        showStatus
        avatarClassName={isCollapsed ? "h-8 w-8" : "h-10 w-10"}
        statusClassName={isCollapsed ? "h-2 w-2" : "h-2.5 w-2.5"}
      />
    )
  }

  const renderText = () => {
    const data = contact.type === "curator" ? contact.curator : contact.employee

    return (
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="max-w-[170px] truncate font-medium">{data?.name}</span>
        <span
          className="max-w-[130px] truncate text-muted-foreground"
          title={data?.role}
        >
          {data?.role}
        </span>
      </div>
    )
  }

  const renderAlertDialog = () => (
    <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除「{displayName}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={handleDeleteConfirm}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  const renderDetailDialog = () => {
    if (contact.type === "employee") {
      return (
        <EmployeeDetailDialog
          contact={contact}
          open={detailOpen}
          onOpenChange={setDetailOpen}
        />
      )
    }
    return null
  }

  const renderContextMenu = () => {
    if (contact.type === "curator") return null

    return (
      <ContextMenuContent className="w-36">
        <ContextMenuItem onSelect={handleDetail}>
          <IconInfoCircle className="text-muted-foreground" />
          <span>详情</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={async () => {
            await queryClient.invalidateQueries({
              queryKey: chatKeys.contacts(),
            })
          }}
        >
          <IconRefresh className="text-muted-foreground" />
          <span>刷新</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={handleDeleteClick}>
          <IconTrash />
          <span>删除</span>
        </ContextMenuItem>
      </ContextMenuContent>
    )
  }

  if (isCollapsed) {
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                "cursor-pointer transition-transform hover:scale-105",
                isSelected &&
                  "rounded-md ring-1 ring-primary ring-offset-1 ring-offset-primary",
                className
              )}
              {...props}
              onClick={handleClick}
              onDoubleClick={(e) => {
                e.stopPropagation()
                onDoubleClick?.()
              }}
              title={displayName}
            >
              {renderAvatar()}
            </div>
          </ContextMenuTrigger>
          {renderContextMenu()}
        </ContextMenu>
        {renderAlertDialog()}
        {renderDetailDialog()}
      </>
    )
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group relative flex cursor-pointer items-center gap-2 rounded-md p-2 text-xs transition-colors hover:bg-primary/10 hover:text-foreground",
              isSelected && "bg-primary/15 text-primary",
              className
            )}
            {...props}
            onClick={handleClick}
            onDoubleClick={(e) => {
              e.stopPropagation()
              onDoubleClick?.()
            }}
          >
            <div className="relative shrink-0">{renderAvatar()}</div>
            {renderText()}
          </div>
        </ContextMenuTrigger>
        {renderContextMenu()}
      </ContextMenu>
      {renderAlertDialog()}
      {renderDetailDialog()}
    </>
  )
}

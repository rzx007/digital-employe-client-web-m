import * as React from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"

import { IconInfoCircle, IconTrash } from "@tabler/icons-react"
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
import type { Contact } from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"

import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { EmployeeDetailDialog } from "../employee/employee-detail-dialog"
import { GroupDetailDialog } from "./group-detail-dialog"

interface ContactItemProps extends React.ComponentProps<"div"> {
  contact: Contact
  isCollapsed: boolean
  onDoubleClick?: () => void
}

export function ContactItem({
  contact,
  isCollapsed,
  onDoubleClick,
  className,
  ...props
}: ContactItemProps) {
  const { contacts, selectedContactId, setContacts, setSelectedContactId } =
    useChatStore(
      useShallow((state) => ({
        contacts: state.contacts,
        selectedContactId: state.selectedContactId,
        setContacts: state.setContacts,
        setSelectedContactId: state.setSelectedContactId,
      }))
    )
  const contactId =
    contact.type === "curator"
      ? contact.curator?.id
      : contact.type === "employee"
        ? contact.employee?.id
        : contact.group?.id
  const isSelected = selectedContactId === contactId

  const [alertOpen, setAlertOpen] = React.useState(false)
  const [detailOpen, setDetailOpen] = React.useState(false)

  const displayName =
    contact.type === "group"
      ? contact.group?.name
      : contact.type === "curator"
        ? contact.curator?.name
        : contact.employee?.name

  const handleClick = () => {
    setSelectedContactId(contactId || null)
  }

  const handleDetail = () => {
    setDetailOpen(true)
  }

  const handleDeleteClick = () => {
    setAlertOpen(true)
  }

  const handleDeleteConfirm = () => {
    setAlertOpen(false)

    const updated = contacts.filter((c) => {
      const id =
        c.type === "curator"
          ? c.curator?.id
          : c.type === "employee"
            ? c.employee?.id
            : c.group?.id
      return id !== contactId
    })
    setContacts(updated)

    if (selectedContactId === contactId) {
      setSelectedContactId(null)
    }

    toast.success(`已删除「${displayName}」`)
  }

  const renderAvatar = () => {
    if (contact.type === "group") {
      return (
        <GroupMembersAvatar
          participants={contact.group?.participants}
          className={cn(
            isCollapsed ? "h-8 w-8" : "size-9 gap-1",
            !isCollapsed && "item-[img]:h-[18px] item-[img]:w-[18px]"
          )}
          itemClassName={!isCollapsed ? "h-[18px] w-[18px]" : undefined}
          fallbackClassName={!isCollapsed ? "text-[10px]" : undefined}
          placeholderClassName={!isCollapsed ? "h-[18px] w-[18px]" : undefined}
        />
      )
    }

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
    if (contact.type === "group") {
      return (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-medium">{contact.group?.name}</span>
          <span className="truncate text-muted-foreground">
            {contact.group?.participants.length} 位成员
          </span>
        </div>
      )
    }

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
    if (contact.type === "group") {
      return (
        <GroupDetailDialog
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

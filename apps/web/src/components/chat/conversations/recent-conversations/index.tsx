import * as React from "react"
import { IconCirclePlus } from "@tabler/icons-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { CreateGroupDialog } from "../../dialogs/create-group-dialog"
import { GroupDetailDialog } from "../../dialogs/group-detail-dialog"
import { EmployeeDetailDialog } from "../../../employee/employee-detail-dialog"
import { RecentConversationRow } from "./recent-conversation-row"
import { RecentConversationsToolbar } from "./recent-conversations-toolbar"
import { useRecentConversations } from "./use-recent-conversations"

export function RecentConversations({
  className,
  collapsed,
  ...props
}: React.ComponentProps<"div"> & { collapsed?: boolean }) {
  const {
    displayItems,
    searchQuery,
    setSearchQuery,
    employeeList,
    isDialogOpen,
    setIsDialogOpen,
    handleCreateGroup,
    detailContact,
    detailOpen,
    setDetailOpen,
    handleSelectItem,
    handleDetail,
    handleTogglePin,
    handleRemove,
    isItemSelected,
    removingContactId,
  } = useRecentConversations()

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
          <RecentConversationsToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpenCreateGroup={() => setIsDialogOpen(true)}
          />
        )}

        <ScrollArea className="min-h-0 w-full flex-1">
          <div className={cn("px-1 py-2", collapsed && "px-1.5")}>
            {displayItems.map((item) => (
              <React.Fragment key={item.contactId}>
                <RecentConversationRow
                  item={item}
                  collapsed={collapsed}
                  isSelected={isItemSelected(item)}
                  onSelect={handleSelectItem}
                  onDetail={handleDetail}
                  onTogglePin={handleTogglePin}
                  onRemove={handleRemove}
                  isRemoving={removingContactId === item.contactId}
                />
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

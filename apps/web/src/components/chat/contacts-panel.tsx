import * as React from "react"
import {
  IconCirclePlus,
  IconSearch,
  IconUser,
} from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import { PRIMARY_CURATOR, type AIEmployee } from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"
import { ContactItem } from "./contact-item"
import { CreateGroupDialog } from "./create-group-dialog"

const CURATOR_CONTACT = { type: "curator" as const, curator: PRIMARY_CURATOR }

export function ContactsPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const { setContacts, selectedContactId, setSelectedContactId, startDraftConversation } =
    useChatStore(
      useShallow((state) => ({
        setContacts: state.setContacts,
        selectedContactId: state.selectedContactId,
        setSelectedContactId: state.setSelectedContactId,
        startDraftConversation: state.startDraftConversation,
      }))
    )
  const { data: apiContacts } = useContactsQuery()

  const contacts = React.useMemo(
    () => [CURATOR_CONTACT, ...(apiContacts ?? [])],
    [apiContacts]
  )

  React.useEffect(() => {
    setContacts(contacts)
  }, [contacts, setContacts])

  const curatorContacts = React.useMemo(
    () => contacts.filter((c) => c.type === "curator"),
    [contacts]
  )
  const groupContacts = React.useMemo(
    () => contacts.filter((c) => c.type === "group"),
    [contacts]
  )
  const employeeContacts = React.useMemo(
    () => contacts.filter((c) => c.type === "employee"),
    [contacts]
  )

  const employeeList = React.useMemo(
    () =>
      employeeContacts.map((c) => c.employee).filter(Boolean) as AIEmployee[],
    [employeeContacts]
  )

  const handleCreateGroup = (selectedEmployees: AIEmployee[]) => {
    console.log("创建群聊，选择员工:", selectedEmployees)
    setIsDialogOpen(false)
  }

  const handleDoubleClickContact = (contactId: string) => {
    startDraftConversation(contactId)
  }

  return (
    <>
      <CreateGroupDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        employees={employeeList}
        onCreate={handleCreateGroup}
      />
      <div
        className={cn(
          "flex h-full w-full flex-col border-r bg-muted/50 transition-all duration-300",
          className
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-medium">通讯录</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="搜索"
            >
              <IconSearch className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="添加联系人"
              onClick={() => toast.info("添加联系人功能开发中")}
            >
              <IconCirclePlus className="size-4" />
            </Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="w-full space-y-3 px-2 py-2">
            <div className="space-y-0.5">
              <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                总管助手
              </p>
              {curatorContacts.map((contact) => (
                <ContactItem
                  key={contact.curator?.id}
                  contact={contact}
                  isCollapsed={false}
                  onDoubleClick={() =>
                    handleDoubleClickContact(contact.curator?.id ?? "")
                  }
                />
              ))}
            </div>

            {groupContacts.length > 0 && (
              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  群聊
                </p>
                {groupContacts.map((contact) => (
                  <ContactItem
                    key={contact.group?.id}
                    contact={contact}
                    isCollapsed={false}
                    onDoubleClick={() =>
                      handleDoubleClickContact(contact.group?.id ?? "")
                    }
                  />
                ))}
              </div>
            )}

            {employeeContacts.length > 0 && (
              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  联系人
                </p>
                {employeeContacts.map((contact) => (
                  <ContactItem
                    key={contact.employee?.id}
                    contact={contact}
                    isCollapsed={false}
                    onDoubleClick={() =>
                      handleDoubleClickContact(contact.employee?.id ?? "")
                    }
                  />
                ))}
              </div>
            )}

            {groupContacts.length === 0 &&
              employeeContacts.length === 0 && (
                <div className="flex flex-col items-center justify-center px-2 py-10 text-muted-foreground/60">
                  <IconUser className="size-8 stroke-1" />
                  <p className="mt-2 text-xs">暂无联系人</p>
                </div>
              )}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}

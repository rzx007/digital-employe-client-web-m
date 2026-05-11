import * as React from "react"
import { useNavigate } from "@tanstack/react-router"
import { IconSearch, IconUser, IconUserPlus } from "@tabler/icons-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { type AIEmployee } from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"
import { ContactItem } from "./contact-item"
import { CreateGroupDialog } from "../dialogs/create-group-dialog"

export function ContactsPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const navigate = useNavigate()
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const [searchQuery, setSearchQuery] = React.useState("")
  const { switchToContact } = useChatStore(
    useShallow((state) => ({
      switchToContact: state.switchToContact,
    }))
  )

  const contacts = useChatStore((s) => s.contacts)

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
    switchToContact(contactId)
  }

  const q = searchQuery.toLowerCase()
  const filteredCuratorContacts = React.useMemo(
    () =>
      curatorContacts.filter((c) => {
        if (!q) return true
        return c.curator?.name.toLowerCase().includes(q)
      }),
    [curatorContacts, q]
  )
  const filteredGroupContacts = React.useMemo(
    () =>
      groupContacts.filter((c) => {
        if (!q) return true
        return c.group?.name.toLowerCase().includes(q)
      }),
    [groupContacts, q]
  )
  const filteredEmployeeContacts = React.useMemo(
    () =>
      employeeContacts.filter((c) => {
        if (!q) return true
        return c.employee?.name.toLowerCase().includes(q)
      }),
    [employeeContacts, q]
  )

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
          "flex h-full min-h-0 w-full flex-col border-r bg-muted/50 transition-all duration-300",
          className
        )}
        {...props}
      >
        <div className="flex items-center gap-1.5 border-b px-3 py-4">
          <div className="relative flex-1">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 border-none bg-background pl-7 text-xs"
              placeholder="搜索联系人..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-7 w-7 shrink-0"
            onClick={async () => {
              if (window.electronApi?.openRecruitment) {
                await window.electronApi.openRecruitment()
              } else {
                navigate({ to: "/recruitment" })
              }
            }}
          >
            <IconUserPlus className="size-4" />
          </Button>
        </div>

        <ScrollArea className="min-h-0 w-full flex-1">
          <div className="w-full space-y-3 px-1 py-2">
            <div className="space-y-0.5">
              <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                总管助手
              </p>
              {filteredCuratorContacts.map((contact) => (
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

            {filteredGroupContacts.length > 0 && (
              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  群聊
                </p>
                {filteredGroupContacts.map((contact) => (
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

            {filteredEmployeeContacts.length > 0 && (
              <div className="space-y-0.5" data-tour-id="contact-employee">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  联系人
                </p>
                {filteredEmployeeContacts.map((contact) => (
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

            {filteredCuratorContacts.length === 0 &&
              filteredGroupContacts.length === 0 &&
              filteredEmployeeContacts.length === 0 && (
                <div className="flex flex-col items-center justify-center px-2 py-10 text-muted-foreground/60">
                  <IconUser className="size-8 stroke-1" />
                  <p className="mt-2 text-xs">
                    {searchQuery ? "未找到匹配的联系人" : "暂无联系人"}
                  </p>
                </div>
              )}
          </div>
        </ScrollArea>
      </div>
    </>
  )
}

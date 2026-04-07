import * as React from "react"
import {
  IconChevronLeft,
  IconChevronRight,
  IconCirclePlus,
  IconRefresh,
  IconSearch,
  IconUser,
} from "@tabler/icons-react"
import { useLocalStorageState } from "ahooks"
import { useMutation } from "@tanstack/react-query"
import { useShallow } from "zustand/react/shallow"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useContactsQuery } from "@/hooks/use-chat-queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { request } from "@/lib/request"
import {
  DEFAULT_SELECTED_CONTACT_ID,
  findContactInList,
  PRIMARY_CURATOR,
  type AIEmployee,
  type Contact,
} from "@/lib/mock-data/ai-employees"
import { useChatStore } from "@/stores/chat-store"
import { useMonitorStore } from "@/stores/monitor-store"

import { ContactItem } from "./contact-item"
import { CreateGroupDialog } from "./create-group-dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"

const CONTACTS_SIDEBAR_COLLAPSED_STORAGE_KEY = "chat:contacts-sidebar:collapsed"

const CURATOR_CONTACT: Contact = {
  type: "curator",
  curator: PRIMARY_CURATOR,
}

export function ContactsSidebar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [isCollapsed = false, setIsCollapsed] = useLocalStorageState<boolean>(
    CONTACTS_SIDEBAR_COLLAPSED_STORAGE_KEY,
    {
      defaultValue: false,
    }
  )
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const { setContacts, selectedContactId, setSelectedContactId } = useChatStore(
    useShallow((state) => ({
      setContacts: state.setContacts,
      selectedContactId: state.selectedContactId,
      setSelectedContactId: state.setSelectedContactId,
    }))
  )
  const { data: apiContacts } = useContactsQuery()
  const isMobile = useIsMobile()
  const setTargetEmployee = useMonitorStore((s) => s.setTargetEmployee)

  const syncMutation = useMutation({
    mutationFn: () =>
      request<{ code: number; msg: string }>(`/workspaces/1/tasks/sync`),
    onSuccess: (res) => {
      toast.success(res.msg || "同步成功")
    },
    onError: () => {
      toast.error("同步失败，请稍后重试")
    },
  })

  const contacts = React.useMemo(
    () => [CURATOR_CONTACT, ...(apiContacts ?? [])],
    [apiContacts]
  )

  React.useEffect(() => {
    setContacts(contacts)
  }, [contacts, setContacts])

  React.useEffect(() => {
    if (
      contacts.length > 0 &&
      selectedContactId &&
      !findContactInList(contacts, selectedContactId)
    ) {
      setSelectedContactId(DEFAULT_SELECTED_CONTACT_ID)
    }
  }, [contacts, selectedContactId, setSelectedContactId])

  React.useEffect(() => {
    if (!selectedContactId) return
    const contact = findContactInList(contacts, selectedContactId)
    if (contact?.type === "employee" && contact.employee) {
      setTargetEmployee(String(contact.employee.id), contact.employee.name)
    }
  }, [selectedContactId, contacts, setTargetEmployee])

  const curatorContacts = React.useMemo(
    () => contacts.filter((contact) => contact.type === "curator"),
    [contacts]
  )

  const employeeContacts = React.useMemo(
    () => contacts.filter((contact) => contact.type === "employee"),
    [contacts]
  )

  const handleCreateGroup = (selectedEmployees: AIEmployee[]) => {
    console.log("创建群聊，选择员工:", selectedEmployees)
    setIsDialogOpen(false)
  }

  const groupContacts = React.useMemo(
    () => contacts.filter((contact) => contact.type === "group"),
    [contacts]
  )

  const employeeList = React.useMemo(
    () =>
      employeeContacts.map((c) => c.employee).filter(Boolean) as AIEmployee[],
    [employeeContacts]
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
          "flex h-full flex-col border-r bg-muted/50 transition-all duration-300",
          isCollapsed ? "w-14" : isMobile ? "w-full" : "w-64",
          className
        )}
        {...props}
      >
        <div
          className={cn(
            "flex shrink-0 items-center border-b p-4 wrap-break-word",
            isCollapsed ? "flex-col space-y-4" : "justify-between"
          )}
        >
          {!isCollapsed && (
            <span className="text-lg font-semibold">员工列表</span>
          )}
          <div
            className={cn(
              "flex items-center",
              isCollapsed ? "w-full flex-col space-y-4" : ""
            )}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="搜索"
            >
              <IconSearch className="size-4" />
            </Button>
            <Button
              onClick={() => setIsDialogOpen(true)}
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              title="新建群聊"
            >
              <IconCirclePlus className="size-4" />
            </Button>
          </div>
        </div>

        <ScrollArea
          className={cn("flex-1 overflow-y-auto", isCollapsed && "py-2")}
        >
          {isCollapsed ? (
            <div className="flex flex-col items-center gap-2 px-2 py-0.5">
              {curatorContacts.map((contact) => (
                <ContactItem
                  key={contact.curator?.id}
                  contact={contact}
                  isCollapsed={isCollapsed}
                />
              ))}

              <div className="my-1 h-px w-7 bg-border" />

              {groupContacts.map((contact) => (
                <ContactItem
                  key={contact.group?.id}
                  contact={contact}
                  isCollapsed={isCollapsed}
                />
              ))}

              <div className="my-1 h-px w-7 bg-border" />

              {employeeContacts.map((contact) => (
                <ContactItem
                  key={contact.employee?.id}
                  contact={contact}
                  isCollapsed={isCollapsed}
                />
              ))}
            </div>
          ) : (
            <div className="w-full space-y-3 px-2 py-2">
              <div className="space-y-0.5">
                <p className="px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  总管助手
                </p>
                {curatorContacts.map((contact) => (
                  <ContactItem
                    key={contact.curator?.id}
                    contact={contact}
                    isCollapsed={isCollapsed}
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
                      isCollapsed={isCollapsed}
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
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </div>
              )}

              {groupContacts.length === 0 && employeeContacts.length === 0 && (
                <div className="flex flex-col items-center justify-center px-2 py-10 text-muted-foreground/60">
                  <IconUser className="size-8 stroke-1" />
                  <p className="mt-2 text-xs">暂无联系人</p>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div
          className={cn(
            "flex border-t p-2",
            isCollapsed
              ? "flex-col items-center gap-2"
              : "items-center justify-between"
          )}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            title="同步任务"
            disabled={syncMutation.isPending}
            onClick={() => syncMutation.mutate()}
          >
            <IconRefresh
              className={cn("size-4", syncMutation.isPending && "animate-spin")}
            />
          </Button>
          {/* <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            title="设置"
          >
            <IconSettings className="size-4" />
          </Button> */}
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "展开" : "折叠"}
          >
            {isCollapsed ? (
              <IconChevronRight className="size-4" />
            ) : (
              <IconChevronLeft className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </>
  )
}

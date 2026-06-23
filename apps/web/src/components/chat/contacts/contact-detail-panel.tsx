import { IconMessage, IconUsers } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { switchToContact } from "@/lib/chat/conversation-selection"
import { getContactId } from "@/lib/chat/contact-utils"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"
import { useChatStore } from "@/stores/chat-store"
import {
  useExecutionMetrics7d,
  useTodayTaskRuns,
} from "@/hooks/use-schedule-monitor-queries"
import {
  getContactDisplayName,
  type ChatViewContact,
} from "../shared/chat-view-shared"
import { EmployeeContactAvatar } from "./contact-avatars"
import { ExecutionDetail } from "@/components/schedule-monitor/sections/execution-detail"
import { ExecutionMetricsCard } from "@/components/schedule-monitor/sections/execution-metrics-card"
import { EmployeeEditForm } from "@/components/employee/employee-edit-form"
import { CuratorOverviewSection } from "./curator-overview-section"
import { GrowthBrainSection } from "./growth-brain-section"

export function ContactDetailPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const selectedContact = useChatStore((s) => s.getDetailContact())

  const handleSendMessage = () => {
    if (!selectedContact) return
    const id = getContactId(selectedContact)
    if (id) switchToContact(id)
  }

  if (!selectedContact) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center text-muted-foreground/60",
          className
        )}
        {...props}
      >
        <div className="flex flex-col items-center gap-2">
          <IconUsers className="size-12 stroke-1" />
          <p className="text-sm">选择联系人查看详情</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn("flex h-full flex-col bg-muted/30", className)}
      {...props}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          <ContactProfileCard
            contact={selectedContact}
            onSendMessage={
              selectedContact.type === "curator"
                ? handleSendMessage
                : undefined
            }
          />
          {selectedContact.type === "employee" &&
            selectedContact.employee?.id && (
              <Tabs defaultValue="profile" className="w-full">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="profile" className="flex-1">
                    资料与执行
                  </TabsTrigger>
                  <TabsTrigger value="growth" className="flex-1">
                    成长履历
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="profile">
                  <div className="space-y-6">
                    <EmployeeEditForm
                      key={selectedContact.employee?.id}
                      employeeId={selectedContact.employee?.id ?? ""}
                    />
                    <div className="space-y-3 border-t pt-6">
                      <h3 className="text-sm font-medium text-muted-foreground">
                        执行历史
                      </h3>
                      <ContactExecutionSection
                        employeeId={selectedContact.employee?.id ?? ""}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="growth">
                  <GrowthBrainSection
                    employeeId={selectedContact.employee?.id ?? null}
                  />
                </TabsContent>
              </Tabs>
            )}
          {selectedContact.type === "curator" && <CuratorOverviewSection />}
        </div>
      </ScrollArea>
    </div>
  )
}

function ContactProfileCard({
  contact,
  onSendMessage,
}: {
  contact: ChatViewContact
  onSendMessage?: () => void
}) {
  const displayName = getContactDisplayName(contact)

  const role =
    contact.type === "curator" ? contact.curator?.role : contact.employee?.role

  const status =
    contact.type === "curator"
      ? contact.curator?.status
      : contact.employee?.status

  const avatarData =
    contact.type === "curator" ? contact.curator : contact.employee

  const specialty =
    contact.type === "curator"
      ? contact.curator?.specialty
      : contact.employee?.specialty

  return (
    <div className="border bg-background p-6">
      <div className="flex items-start gap-4">
        <EmployeeContactAvatar
          name={avatarData?.name}
          avatar={avatarData?.avatar}
          status={status}
          showStatus
          className="size-16"
          avatarClassName="size-16"
          statusClassName="h-3 w-3"
        />

        <div className="flex flex-1 flex-col gap-1">
          <h2 className="text-lg font-semibold">{displayName}</h2>
          <p className="text-sm text-muted-foreground">{role}</p>
          {status && (
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-2 rounded-full",
                  status === "online"
                    ? "bg-green-500"
                    : status === "busy"
                      ? "bg-amber-500"
                      : "bg-gray-400"
                )}
              />
              <span className="text-xs text-muted-foreground">
                {status === "online"
                  ? "在线"
                  : status === "busy"
                    ? "忙碌"
                    : "离线"}
              </span>
            </div>
          )}
          {specialty && (
            <p className="mt-1 text-xs text-muted-foreground">{specialty}</p>
          )}
        </div>
      </div>

      {onSendMessage && (
        <div className="mt-4">
          <Button onClick={onSendMessage} className="gap-2">
            <IconMessage className="size-4" />
            发消息
          </Button>
        </div>
      )}
    </div>
  )
}

function ContactExecutionSection({ employeeId }: { employeeId: string }) {
  const { data: taskRuns = [] } = useTodayTaskRuns(employeeId)
  const { data: executionMetrics } = useExecutionMetrics7d(employeeId)

  return (
    <div className="space-y-4">
      <ExecutionMetricsCard metrics={executionMetrics} />

      <ExecutionDetail runs={taskRuns} />
    </div>
  )
}

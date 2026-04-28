import { useState } from "react"
import { IconMessage, IconUsers } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
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
  useAnomalies,
  useMonthlyScheduleOverview,
  useTaskSummary,
  useTodayTaskRuns,
} from "@/hooks/use-schedule-monitor-queries"
import { getContactDisplayName, type ChatViewContact } from "./chat-view-shared"
import { EmployeeContactAvatar, GroupMembersAvatar } from "./contact-avatars"
import { ScheduleCalendar } from "../schedule-monitor/sections/schedule-calendar"
import { TaskStatsCards } from "../schedule-monitor/sections/task-stats-cards"
import { ExecutionDetail } from "../schedule-monitor/sections/execution-detail"
import { AnomalyMonitor } from "../schedule-monitor/sections/anomaly-monitor"
import { EmployeeEditForm } from "../employee/employee-edit-form"
import { CuratorOverviewSection } from "./curator-overview-section"

export function ContactDetailPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const selectedContact = useChatStore((s) => s.getSelectedContact())
  const switchToContact = useChatStore((s) => s.switchToContact)

  const handleSendMessage = () => {
    const contact = useChatStore.getState().getSelectedContact()
    if (!contact) return
    const id =
      contact.type === "curator"
        ? contact.curator?.id
        : contact.type === "employee"
          ? contact.employee?.id
          : contact.group?.id
    if (id) {
      switchToContact(id)
    }
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
            onSendMessage={handleSendMessage}
          />
          {selectedContact.type === "employee" &&
            selectedContact.employee?.id && (
              <Tabs defaultValue="tasks" className="w-full">
                <TabsList variant="line" className="w-full">
                  <TabsTrigger value="tasks" className="flex-1">
                    任务监控
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="flex-1">
                    编辑员工
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="edit">
                  <EmployeeEditForm
                    key={selectedContact.employee?.id}
                    employeeId={selectedContact.employee?.id ?? ""}
                  />
                </TabsContent>
                <TabsContent value="tasks">
                  <ContactMonitorSection
                    employeeId={selectedContact.employee?.id ?? ""}
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
  onSendMessage: () => void
}) {
  const displayName = getContactDisplayName(contact)

  const role =
    contact.type === "group"
      ? `${contact.group?.participants.length ?? 0} 位成员`
      : contact.type === "curator"
        ? contact.curator?.role
        : contact.employee?.role

  const status =
    contact.type === "curator"
      ? contact.curator?.status
      : contact.type === "employee"
        ? contact.employee?.status
        : undefined

  const avatarData =
    contact.type === "curator"
      ? contact.curator
      : contact.type === "employee"
        ? contact.employee
        : undefined

  const specialty =
    contact.type === "curator"
      ? contact.curator?.specialty
      : contact.type === "employee"
        ? contact.employee?.specialty
        : undefined

  return (
    <div className="border bg-background p-6">
      <div className="flex items-start gap-4">
        {contact.type === "group" ? (
          <GroupMembersAvatar
            participants={contact.group?.participants ?? []}
            className="size-16"
          />
        ) : (
          <EmployeeContactAvatar
            name={avatarData?.name}
            avatar={avatarData?.avatar}
            status={status}
            showStatus
            className="size-16"
            avatarClassName="size-16"
            statusClassName="h-3 w-3"
          />
        )}

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

      <div className="mt-4">
        <Button onClick={onSendMessage} className="gap-2">
          <IconMessage className="size-4" />
          发消息
        </Button>
      </div>
    </div>
  )
}

function ContactMonitorSection({ employeeId }: { employeeId: string }) {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth() + 1)

  const { data: overview } = useMonthlyScheduleOverview(
    employeeId,
    viewYear,
    viewMonth
  )
  const { data: taskRuns = [] } = useTodayTaskRuns(employeeId)
  const { data: summary } = useTaskSummary(employeeId)
  const { data: anomalies = [] } = useAnomalies(employeeId)

  const handleMonthChange = (year: number, month: number) => {
    setViewYear(year)
    setViewMonth(month)
  }

  return (
    <div className="space-y-4">
      {summary && <TaskStatsCards summary={summary} />}

      {overview && (
        <ScheduleCalendar
          overview={overview}
          onMonthChange={handleMonthChange}
        />
      )}

      <ExecutionDetail runs={taskRuns} />

      <AnomalyMonitor anomalies={anomalies} />
    </div>
  )
}

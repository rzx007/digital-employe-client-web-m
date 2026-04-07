import * as React from "react"

import {
  IconChevronDown,
  IconChevronRight,
  IconMessage,
  IconSparkles,
  IconTool,
} from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import type { MetadataSkill } from "@/api/types"
import type { Contact } from "@/lib/mock-data/ai-employees"
import { createDiceBearAvatar } from "@/lib/avatar"
import { useChatStore } from "@/stores/chat-store"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"

import { EmployeeContactAvatar } from "./contact-avatars"

interface EmployeeDetailDialogProps {
  contact: Contact
  open: boolean
  onOpenChange: (open: boolean) => void
}

const statusMap: Record<number, { label: string; color: string }> = {
  1: { label: "在线", color: "bg-green-500" },
  0: { label: "离线", color: "bg-gray-400" },
}

function formatDate(dateStr?: string) {
  if (!dateStr) return "-"
  return new Date(dateStr).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
}

function SkillCard({ skill }: { skill: MetadataSkill }) {
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-md border">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 p-2.5 text-left text-xs transition-colors hover:bg-accent/50"
          >
            {open ? (
              <IconChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <IconChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">
              {skill.skillName}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {skill.status === 1 ? "已启用" : "未启用"}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t px-2.5 pt-2 pb-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {skill.description}
            </p>
            {skill.directoryName && (
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                目录: {skill.directoryName}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

export function EmployeeDetailDialog({
  contact,
  open,
  onOpenChange,
}: EmployeeDetailDialogProps) {
  const employeeId = contact.employee?.id ?? ""
  const { data: employee, isLoading } = useEmployeeDetailQuery(
    open ? employeeId : null
  )

  const { setSelectedContactId } = useChatStore()

  const handleSendMessage = () => {
    onOpenChange(false)
    setSelectedContactId(employeeId)
  }

  const metadata = employee?.metadata
  const capabilities = metadata?.capabilities ?? []
  const skills = metadata?.skills ?? []
  const statusInfo = metadata
    ? (statusMap[metadata.status] ?? statusMap[0])
    : null

  const hasContent = skills.length > 0 || capabilities.length > 0 || !isLoading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-5 pb-3 text-center">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2">
              <Skeleton className="h-16 w-16" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
          ) : (
            <>
              <div className="flex justify-center">
                <EmployeeContactAvatar
                  name={employee?.name ?? contact.employee?.name}
                  avatar={createDiceBearAvatar(
                    String(employee?.id ?? contact.employee?.id ?? "")
                  )}
                  status={contact.employee?.status}
                  showStatus
                  avatarClassName="h-16 w-16"
                  statusClassName="h-3.5 w-3.5 border-2"
                />
              </div>
              <DialogTitle className="text-base">
                {employee?.name ?? contact.employee?.name}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {metadata?.capability_desc ?? contact.employee?.role}
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-4 py-3">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-16" />
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              </div>
            ) : hasContent ? (
              <>
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">
                      基础信息
                    </span>
                  </div>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">状态</span>
                      <span className="flex items-center gap-1.5">
                        {statusInfo && (
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${statusInfo.color}`}
                          />
                        )}
                        {statusInfo?.label ?? "未知"}
                      </span>
                    </div>
                    {employee?.employee_code && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">编码</span>
                        <span className="font-mono">
                          {employee.employee_code}
                        </span>
                      </div>
                    )}
                    {employee?.version && (
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">版本</span>
                        <span>v{employee.version}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">创建时间</span>
                      <span>{formatDate(employee?.created_at)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">更新时间</span>
                      <span>{formatDate(employee?.updated_at)}</span>
                    </div>
                  </div>
                </div>

                {skills.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5">
                      <IconSparkles className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">
                        技能 ({skills.length})
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {skills.map((skill) => (
                        <SkillCard key={skill.id} skill={skill} />
                      ))}
                    </div>
                  </div>
                )}

                {capabilities.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5">
                      <IconTool className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">
                        能力 ({capabilities.length})
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {capabilities.map((cap, index) => (
                        <div
                          key={index}
                          className="rounded-md border p-2.5 text-xs"
                        >
                          <div className="mb-0.5 font-medium">
                            {cap.capability_name}
                          </div>
                          <div className="leading-relaxed text-muted-foreground">
                            {cap.capability_desc}
                          </div>
                          {(cap.mcp_server_name || cap.mcp_tool_name) && (
                            <div className="mt-1.5 flex items-center gap-1 text-muted-foreground">
                              <IconTool className="size-3" />
                              <span className="font-mono text-[11px]">
                                {cap.mcp_server_name}
                                {cap.mcp_tool_name && ` / ${cap.mcp_tool_name}`}
                              </span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="px-4 py-3">
          <Button onClick={handleSendMessage} className="w-full" size="sm">
            <IconMessage className="size-3.5" />
            发消息
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

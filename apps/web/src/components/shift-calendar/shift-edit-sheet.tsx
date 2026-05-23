import * as React from "react"
import { IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { createDiceBearAvatar } from "@/lib/avatar"
import { fetchMcpList, fetchSkillList, updateEmployee } from "@/api/employee"
import type {
  McpListItem,
  MetadataMcp,
  MetadataSkill,
  SkillListItem,
} from "@/api/types"
import { useQueryClient } from "@tanstack/react-query"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"
import { chatKeys } from "@/lib/query-keys/chat"
import {
  convertApiEmployeeTasksToListItems,
  tasksToApiPayload,
  type ApiEmployeeTaskRead,
  type ScheduleTaskListItem,
  type ShiftScheduleForm,
} from "@/types/task"
import { ScheduleTaskConfig } from "@/components/employee/schedule-task-config"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

interface ApiSkillResponse {
  id: number
  skill_id: number
  skill_name: string
  skill_name_zh: string
  skill_description: string
}

function convertApiSkillsToMetadataSkills(
  apiSkills: ApiSkillResponse[] | undefined
): MetadataSkill[] {
  if (!apiSkills) return []
  return apiSkills.map((s) => ({
    id: s.id,
    skillName: s.skill_name,
    description: s.skill_description,
    prompt: "",
    directoryId: null,
    status: 1,
    createTime: "",
    updateTime: "",
    directoryName: s.skill_name_zh,
  }))
}

interface ShiftEditSheetProps {
  employeeId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShiftEditSheet({
  employeeId,
  open,
  onOpenChange,
}: ShiftEditSheetProps) {
  const queryClient = useQueryClient()
  const { data: employee, isLoading } = useEmployeeDetailQuery(
    String(employeeId ?? "")
  )

  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(EMPTY_SCHEDULE)
  const [tasks, setTasks] = React.useState<ScheduleTaskListItem[]>([])
  const [initialized, setInitialized] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  const [selectedMcpIds, setSelectedMcpIds] = React.useState<number[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<number[]>([])
  const [employeeSkills, setEmployeeSkills] = React.useState<MetadataSkill[]>(
    []
  )
  const [allMcpList, setAllMcpList] = React.useState<McpListItem[]>([])
  const [allSkillList, setAllSkillList] = React.useState<SkillListItem[]>([])

  React.useEffect(() => {
    fetchMcpList()
      .then(setAllMcpList)
      .catch(() => {})
    fetchSkillList({ localOnly: true })
      .then(setAllSkillList)
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    if (open) {
      setInitialized(false)
    }
  }, [open])

  React.useEffect(() => {
    if (employee && open && !initialized) {
      const meta = employee.metadata as Record<string, unknown> | undefined
      const mcps = (meta?.mcps as MetadataMcp[] | undefined) ?? []
      const apiSkills = meta?.skills as ApiSkillResponse[] | undefined
      const convertedSkills = convertApiSkillsToMetadataSkills(apiSkills)

      setSelectedMcpIds(mcps.map((m) => m.id))
      setEmployeeSkills(convertedSkills)
      setSelectedSkillIds((apiSkills ?? []).map((s) => s.skill_id))

      const metaTasks = meta?.tasks as ApiEmployeeTaskRead[] | undefined
      if (metaTasks && metaTasks.length > 0) {
        setTasks(convertApiEmployeeTasksToListItems(metaTasks))
      } else {
        setTasks([])
      }

      const sch = employee.shift_schedule
      if (sch && (sch.start_date || sch.end_date)) {
        setSchedule({
          start_date: sch.start_date ?? "",
          end_date: sch.end_date ?? "",
          status: sch.status ?? 1,
          notes: sch.notes ?? "",
        })
      } else {
        setSchedule(EMPTY_SCHEDULE)
      }

      setInitialized(true)
    }
  }, [employee, open, initialized])

  const displayName = employee?.metadata?.employee_name ?? employee?.name ?? ""
  const description =
    employee?.metadata?.capability_desc ?? employee?.description ?? ""

  const selectedMcpItems = React.useMemo(
    () => allMcpList.filter((m) => selectedMcpIds.includes(m.id)),
    [allMcpList, selectedMcpIds]
  )
  const selectedSkillItems = React.useMemo(
    () => allSkillList.filter((s) => selectedSkillIds.includes(s.id)),
    [allSkillList, selectedSkillIds]
  )

  const handleSave = async () => {
    if (!employee) return
    setSaving(true)
    try {
      const validMcpIds = selectedMcpIds.filter((id) =>
        allMcpList.some((m) => m.id === id)
      )
      const validSkillIds = selectedSkillIds.filter((id) =>
        allSkillList.some((s) => s.id === id)
      )
      await updateEmployee(employee.id, {
        employee_name: displayName,
        capability_desc: description || null,
        status: employee.metadata?.status ?? 1,
        mcp_ids: validMcpIds,
        skill_ids: validSkillIds,
        shift_schedule: schedule,
        tasks: tasksToApiPayload(tasks),
      })
      await queryClient.invalidateQueries({
        queryKey: [...chatKeys.all, "shift-calendar"],
      })
      queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
      toast.success(`已成功更新「${displayName}」`)
      onOpenChange(false)
    } catch {
      toast.error("更新失败，请稍后重试")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] p-0">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle className="flex items-center gap-3 text-base">
            <Avatar size="sm">
              <AvatarImage
                src={createDiceBearAvatar(String(employeeId ?? ""))}
              />
              <AvatarFallback className="bg-primary/10 text-xs text-primary">
                {displayName.slice(0, 1)}
              </AvatarFallback>
            </Avatar>
            <span>编辑 - {displayName}</span>
          </SheetTitle>
        </SheetHeader>

        {isLoading || !initialized ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            <div className="space-y-4 p-6">
              <div className="space-y-3">
                <Label className="text-xs font-medium text-muted-foreground">
                  基本信息
                </Label>
                <div className="space-y-1.5">
                  <span className="text-xs text-muted-foreground">
                    员工名称
                  </span>
                  <p className="text-sm font-medium">{displayName}</p>
                </div>
                {description && (
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      岗位描述
                    </span>
                    <p className="text-sm">{description}</p>
                  </div>
                )}
                {selectedMcpItems.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">
                      MCP 工具
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedMcpItems.map((item) => (
                        <Badge
                          key={item.id}
                          variant="secondary"
                          className="text-xs"
                        >
                          {item.capability_name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                {selectedSkillItems.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-xs text-muted-foreground">技能</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedSkillItems.map((item) => (
                        <Badge
                          key={item.id}
                          variant="outline"
                          className="text-xs"
                        >
                          {item.displayNameZh || item.skillName}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                <Label className="text-xs font-medium text-muted-foreground">
                  排班和任务
                </Label>
                <ScheduleTaskConfig
                  capabilities={
                    (employee?.metadata?.mcps as MetadataMcp[] | undefined) ??
                    []
                  }
                  capabilityIds={selectedMcpIds}
                  skillIds={selectedSkillIds}
                  skills={employeeSkills}
                  tasks={tasks}
                  schedule={schedule}
                  onTasksChange={setTasks}
                  onScheduleChange={setSchedule}
                />
              </div>

              <Button
                className="w-full gap-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <IconLoader2 className="size-3.5 animate-spin" />
                    保存中...
                  </>
                ) : (
                  "保存修改"
                )}
              </Button>
            </div>
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  )
}

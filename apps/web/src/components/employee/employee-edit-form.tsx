import * as React from "react"

import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { fetchMcpList } from "@/api/employee"
import type { Employee, McpListItem, MetadataMcp } from "@/api/types"
import {
  convertApiEmployeeTasksToListItems,
  tasksToApiPayload,
  type ApiEmployeeTaskRead,
  type ScheduleTaskListItem,
  type ShiftScheduleForm,
} from "@/types/task"
import {
  useEmployeeDetailQuery,
  useUpdateEmployeeMutation,
} from "@/hooks/use-chat-queries"
import { useEmployeePickerSkillsQuery } from "@/hooks/use-skill-queries"

import { CapabilityPickerDialog } from "./capability-picker-dialog"
import { EmployeeSkillBadge } from "./employee-skill-badge"
import { ScheduleTaskConfig } from "./schedule-task-config"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

type EmployeeFormInitial = {
  name: string
  description: string
  showScheduleAndTask: boolean
  tasks: ScheduleTaskListItem[]
  schedule: ShiftScheduleForm
  selectedMcpIds: number[]
  selectedSkillIds: number[]
}

function getEmployeeFormInitialState(employee: Employee): EmployeeFormInitial {
  const meta = employee.metadata
  const metaTasks = (employee.metadata as unknown as Record<string, unknown>)
    ?.tasks as ApiEmployeeTaskRead[] | undefined
  const hasTasks = Boolean(metaTasks?.length)
  const sch = employee.shift_schedule as ShiftScheduleForm | undefined
  const hasSchedule = Boolean(sch)

  return {
    name: meta?.employee_name ?? employee.name ?? "",
    description: meta?.capability_desc ?? employee.description ?? "",
    selectedMcpIds:
      (meta?.mcps as MetadataMcp[] | undefined)?.map((m) => m.id) ?? [],
    selectedSkillIds: (meta?.skills ?? []).map((s) => s.skill_id),
    tasks: hasTasks ? convertApiEmployeeTasksToListItems(metaTasks!) : [],
    schedule: sch ?? EMPTY_SCHEDULE,
    showScheduleAndTask: hasTasks || hasSchedule,
  }
}

function EmployeeEditFormFields({
  employee,
  employeeId,
}: {
  employee: Employee
  employeeId: string
}) {
  const initial = getEmployeeFormInitialState(employee)
  const updateMutation = useUpdateEmployeeMutation(employeeId)

  const [name, setName] = React.useState(initial.name)
  const [description, setDescription] = React.useState(initial.description)
  const [showScheduleAndTask, setShowScheduleAndTask] = React.useState(
    initial.showScheduleAndTask
  )
  const [tasks, setTasks] = React.useState<ScheduleTaskListItem[]>(initial.tasks)
  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(initial.schedule)
  const [selectedMcpIds, setSelectedMcpIds] = React.useState<number[]>(
    initial.selectedMcpIds
  )
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<number[]>(
    initial.selectedSkillIds
  )
  const [allMcpList, setAllMcpList] = React.useState<McpListItem[]>([])
  const { data: allSkillList = [] } = useEmployeePickerSkillsQuery()
  const [pickerOpen, setPickerOpen] = React.useState(false)

  React.useEffect(() => {
    fetchMcpList()
      .then(setAllMcpList)
      .catch(() => {})
  }, [])

  const selectedMcpItems = React.useMemo(
    () => allMcpList.filter((m) => selectedMcpIds.includes(m.id)),
    [allMcpList, selectedMcpIds]
  )
  const selectedSkillItems = React.useMemo(
    () => allSkillList.filter((s) => selectedSkillIds.includes(s.id)),
    [allSkillList, selectedSkillIds]
  )

  const handleRemoveMcp = (id: number) => {
    setSelectedMcpIds((prev) => prev.filter((i) => i !== id))
  }

  const handleRemoveSkill = (id: number) => {
    setSelectedSkillIds((prev) => prev.filter((i) => i !== id))
  }

  const handlePickerConfirm = (mcpIds: number[], skillIds: number[]) => {
    setSelectedMcpIds(mcpIds)
    setSelectedSkillIds(skillIds)
  }

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("请输入员工名称")
      return
    }
    const validMcpIds = selectedMcpIds.filter((id) =>
      allMcpList.some((m) => m.id === id)
    )
    const validSkillIds = selectedSkillIds.filter((id) =>
      allSkillList.some((s) => s.id === id)
    )
    try {
      await updateMutation.mutateAsync({
        employee_name: name.trim(),
        capability_desc: description.trim() || null,
        status: employee.metadata?.status ?? 1,
        mcp_ids: validMcpIds || [],
        skill_ids: validSkillIds || [],
        shift_schedule: showScheduleAndTask ? schedule : null,
        tasks: showScheduleAndTask ? tasksToApiPayload(tasks) : [],
      })
      toast.success(`已成功更新「${name.trim()}」`)
    } catch {
      toast.error("更新失败，请稍后重试")
    }
  }

  return (
    <>
      <div className="flex flex-col">
        <div className="space-y-4">
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground">
              基本信息
            </Label>
            <div className="space-y-1.5">
              <Label className="text-xs">员工名称</Label>
              <Input
                placeholder="请输入员工名称"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">岗位描述</Label>
              <Textarea
                className="min-h-20 resize-none"
                placeholder="请输入岗位描述"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium text-muted-foreground">
                能力配置
              </Label>
              <Button
                variant="ghost"
                size="xs"
                className="gap-1"
                onClick={() => setPickerOpen(true)}
              >
                <IconPlus className="size-3" />
                添加能力
              </Button>
            </div>

            {selectedMcpItems.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">
                  MCP 工具
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMcpItems.map((item) => (
                    <Badge
                      key={item.id}
                      variant="secondary"
                      className="group gap-1 text-xs"
                    >
                      {item.capability_name}
                      <button
                        type="button"
                        className="ml-0.5 rounded-full text-destructive opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/15 focus-visible:opacity-100"
                        onClick={() => handleRemoveMcp(item.id)}
                      >
                        <IconX className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {selectedSkillItems.length > 0 && (
              <div className="space-y-1">
                <span className="text-[10px] text-muted-foreground">技能</span>
                <div className="flex flex-wrap gap-1.5">
                  {selectedSkillItems.map((item) => (
                    <EmployeeSkillBadge
                      key={item.id}
                      skill={item}
                      onRemove={() => handleRemoveSkill(item.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {selectedMcpItems.length === 0 &&
              selectedSkillItems.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  暂未选择任何能力，点击「添加能力」进行选择
                </p>
              )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label
              htmlFor="edit-show-schedule-task"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              配置排班和任务
            </Label>
            <Switch
              id="edit-show-schedule-task"
              checked={showScheduleAndTask}
              onCheckedChange={setShowScheduleAndTask}
            />
          </div>

          {showScheduleAndTask && (
            <ScheduleTaskConfig
              capabilities={employee.metadata?.mcps ?? []}
              capabilityIds={selectedMcpIds}
              skillIds={selectedSkillIds}
              skills={selectedSkillItems}
              tasks={tasks}
              schedule={schedule}
              onTasksChange={setTasks}
              onScheduleChange={setSchedule}
            />
          )}
        </div>

        <div
          className={cn(
            "sticky bottom-0 z-10 shrink-0 border-t border-border/80",
            "bg-background/95 pt-3 pb-0.5 backdrop-blur-sm",
            "shadow-[0_-10px_24px_-16px_rgba(0,0,0,0.2)]",
            "supports-[backdrop-filter]:bg-background/80"
          )}
        >
          <Button
            className="w-full gap-1.5"
            onClick={handleSubmit}
            disabled={!name.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <IconLoader2 className="size-3.5 animate-spin" />
                保存中...
              </>
            ) : (
              "保存修改"
            )}
          </Button>
        </div>
      </div>

      <CapabilityPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allMcpList={allMcpList}
        allSkillList={allSkillList}
        selectedMcpIds={selectedMcpIds}
        selectedSkillIds={selectedSkillIds}
        onConfirm={handlePickerConfirm}
      />
    </>
  )
}

export function EmployeeEditForm({ employeeId }: { employeeId: string }) {
  const { data: employee, isLoading } = useEmployeeDetailQuery(employeeId)

  if (isLoading || !employee) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  return (
    <EmployeeEditFormFields key={employeeId} employee={employee} employeeId={employeeId} />
  )
}

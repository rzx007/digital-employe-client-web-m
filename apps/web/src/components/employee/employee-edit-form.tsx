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
import {
  fetchMcpList,
  fetchSkillList,
} from "@/api/employee"
import type { McpListItem, SkillListItem } from "@/api/types"
import type { ShiftScheduleForm, TaskFormData } from "@/types/task"
import { useEmployeeDetailQuery } from "@/hooks/use-chat-queries"
import { useUpdateEmployeeMutation } from "@/hooks/use-chat-queries"

import { CapabilityPickerDialog } from "./capability-picker-dialog"
import { ScheduleTaskConfig } from "./schedule-task-config"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

export function EmployeeEditForm({ employeeId }: { employeeId: string }) {
  const { data: employee, isLoading } = useEmployeeDetailQuery(employeeId)
  const updateMutation = useUpdateEmployeeMutation(employeeId)

  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [showScheduleAndTask, setShowScheduleAndTask] = React.useState(false)
  const [tasks, setTasks] = React.useState<TaskFormData[]>([])
  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(EMPTY_SCHEDULE)
  const [selectedMcpIds, setSelectedMcpIds] = React.useState<number[]>([])
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<number[]>([])
  const [allMcpList, setAllMcpList] = React.useState<McpListItem[]>([])
  const [allSkillList, setAllSkillList] = React.useState<SkillListItem[]>([])
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [initialized, setInitialized] = React.useState(false)

  React.useEffect(() => {
    fetchMcpList().then(setAllMcpList).catch(() => {})
    fetchSkillList().then(setAllSkillList).catch(() => {})
  }, [])

  React.useEffect(() => {
    if (employee && !initialized) {
      const meta = employee.metadata
      setName(meta?.employee_name ?? employee.name ?? "")
      setDescription(meta?.capability_desc ?? employee.description ?? "")
      setSelectedMcpIds([])
      setSelectedSkillIds([])
      const metaTasks = (employee.metadata as Record<string, unknown>)?.tasks as
        | TaskFormData[]
        | undefined
      if (metaTasks && metaTasks.length > 0) {
        setTasks(metaTasks)
        setShowScheduleAndTask(true)
      }
      const sch = (employee as Record<string, unknown>).shift_schedule as
        | ShiftScheduleForm
        | undefined
      if (sch) {
        setSchedule(sch)
        setShowScheduleAndTask(true)
      }
      setInitialized(true)
    }
  }, [employee, initialized])

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

    try {
      await updateMutation.mutateAsync({
        employee_name: name.trim(),
        capability_desc: description.trim() || null,
        status: employee?.metadata?.status ?? 1,
        capability_ids: selectedMcpIds,
        skill_ids: selectedSkillIds,
        shift_schedule: showScheduleAndTask ? schedule : null,
        tasks: showScheduleAndTask ? tasks : [],
      })
      toast.success(`已成功更新「${name.trim()}」`)
    } catch {
      toast.error("更新失败，请稍后重试")
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    )
  }

  return (
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
                  className="gap-1 text-xs"
                >
                  {item.capability_name}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
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
            <span className="text-[10px] text-muted-foreground">
              技能
            </span>
            <div className="flex flex-wrap gap-1.5">
              {selectedSkillItems.map((item) => (
                <Badge
                  key={item.id}
                  variant="outline"
                  className="gap-1 text-xs"
                >
                  {item.displayNameZh || item.skillName}
                  <button
                    type="button"
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                    onClick={() => handleRemoveSkill(item.id)}
                  >
                    <IconX className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {selectedMcpItems.length === 0 && selectedSkillItems.length === 0 && (
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
          capabilities={employee?.metadata?.capabilities ?? []}
          capabilityIds={selectedMcpIds}
          skillIds={selectedSkillIds}
          skills={employee?.metadata?.skills ?? []}
          tasks={tasks}
          schedule={schedule}
          onTasksChange={setTasks}
          onScheduleChange={setSchedule}
        />
      )}

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

      <CapabilityPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allMcpList={allMcpList}
        allSkillList={allSkillList}
        selectedMcpIds={selectedMcpIds}
        selectedSkillIds={selectedSkillIds}
        onConfirm={handlePickerConfirm}
      />
    </div>
  )
}

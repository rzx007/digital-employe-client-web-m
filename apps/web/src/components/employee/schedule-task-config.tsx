import * as React from "react"

import { IconClock, IconPlus, IconPencil, IconTrash } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { toast } from "sonner"
import type { Capability, MetadataSkill } from "@/api/types"
import { parseCronToExecuteTime } from "@/lib/cron-utils"
import type { ShiftScheduleForm, TaskFormData } from "@/types/task"
import { cn } from "@workspace/ui/lib/utils"

import { TaskEditDialog } from "./task-edit-dialog"

function getCronTypeLabel(type: string) {
  switch (type) {
    case "daily":
      return "每天"
    case "weekdays":
      return "工作日"
    case "weekends":
      return "周末"
    case "loop":
      return "循环"
    default:
      return type
  }
}

function TaskCard({
  task,
  skills,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  task: TaskFormData
  skills: MetadataSkill[]
  onEdit: () => void
  onDelete: () => void
  onToggleActive: (active: boolean) => void
}) {
  const displayTime = React.useMemo(
    () => parseCronToExecuteTime(task.cron_expression) || task.executeTime,
    [task.cron_expression, task.executeTime]
  )

  const targetName = React.useMemo(() => {
    if (task.task_resource_type === "skill") {
      const skill = skills.find((s) => Number(s.id) === task.skill_id)
      return skill?.name ?? "未选择技能"
    }
    return "未选择能力"
  }, [task.task_resource_type, task.skill_id, skills])

  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <IconClock className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium">
            {displayTime || "未设置时间"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {getCronTypeLabel(task.cron_expression_type)}
          </span>
        </div>
        <div className="text-xs">
          <span className="font-medium">{task.task_name || "未命名任务"}</span>
          <span className="ml-1.5 text-muted-foreground">{targetName}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Switch
          checked={task.is_active}
          onCheckedChange={onToggleActive}
          className="scale-75"
        />
        <Button
          variant="ghost"
          size="xs"
          className="size-7 p-0"
          onClick={onEdit}
        >
          <IconPencil className="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="size-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <IconTrash className="size-3" />
        </Button>
      </div>
    </div>
  )
}

interface ScheduleTaskConfigProps {
  capabilities: Capability[]
  capabilityIds?: number[]
  skillIds?: number[]
  skills: MetadataSkill[]
  tasks: TaskFormData[]
  schedule: ShiftScheduleForm
  onTasksChange: (tasks: TaskFormData[]) => void
  onScheduleChange: (schedule: ShiftScheduleForm) => void
}

export function ScheduleTaskConfig({
  capabilities,
  capabilityIds,
  skillIds,
  skills: passedSkills,
  tasks,
  schedule,
  onTasksChange,
  onScheduleChange,
}: ScheduleTaskConfigProps) {
  const [skills, setSkills] = React.useState<MetadataSkill[]>(
    passedSkills ?? []
  )
  const [editOpen, setEditOpen] = React.useState(false)
  const [editIndex, setEditIndex] = React.useState<number | null>(null)
  const [editTask, setEditTask] = React.useState<TaskFormData | null>(null)

  React.useEffect(() => {
    if (passedSkills && passedSkills.length > 0) {
      setSkills(passedSkills)
    }
  }, [passedSkills])

  const handleAddTask = () => {
    setEditIndex(null)
    setEditTask(null)
    setEditOpen(true)
  }

  const handleEditTask = (index: number) => {
    setEditIndex(index)
    setEditTask(tasks[index])
    setEditOpen(true)
  }

  const handleSaveTask = (task: TaskFormData) => {
    if (editIndex !== null) {
      const next = [...tasks]
      next[editIndex] = task
      onTasksChange(next)
    } else {
      onTasksChange([...tasks, task])
    }
    setEditOpen(false)
  }

  const handleDeleteTask = () => {
    if (editIndex === null) return
    const next = tasks.filter((_, i) => i !== editIndex)
    onTasksChange(next)
    setEditOpen(false)
    toast.success("任务已删除")
  }

  const handleToggleActive = (index: number, active: boolean) => {
    const next = [...tasks]
    next[index] = { ...next[index], is_active: active }
    onTasksChange(next)
  }

  const updateSchedule = <K extends keyof ShiftScheduleForm>(
    key: K,
    value: ShiftScheduleForm[K]
  ) => {
    onScheduleChange({ ...schedule, [key]: value })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">工作有效周期（可选）</Label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="flex-1"
              value={schedule.start_date ?? ""}
              onChange={(e) => updateSchedule("start_date", e.target.value)}
            />
            <span className="text-xs text-muted-foreground">至</span>
            <Input
              type="date"
              className="flex-1"
              value={schedule.end_date ?? ""}
              onChange={(e) => updateSchedule("end_date", e.target.value)}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">
            选择员工工作的有效周期，不设置则永久有效
          </p>
        </div>

        <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-3">
          <Label className="text-sm">启用排班</Label>
          <Switch
            checked={schedule.status === 1}
            onCheckedChange={(v) => updateSchedule("status", v ? 1 : 0)}
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">备注（可选）</Label>
          <Input
            placeholder="请输入备注信息"
            value={schedule.notes ?? ""}
            onChange={(e) => updateSchedule("notes", e.target.value)}
          />
        </div>
      </div>

      <div
        className={cn(
          "rounded-lg border",
          tasks.length === 0 ? "border-dashed" : ""
        )}
      >
        <div className="flex items-center justify-between p-3">
          <span className="text-xs font-medium text-muted-foreground">
            任务列表 ({tasks.length})
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1"
            onClick={handleAddTask}
          >
            <IconPlus className="size-3" />
            添加任务
          </Button>
        </div>

        {tasks.length > 0 && (
          <div className="space-y-2 px-3 pb-3">
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id ?? index}
                task={task}
                skills={skills}
                onEdit={() => handleEditTask(index)}
                onDelete={() => {
                  const next = tasks.filter((_, i) => i !== index)
                  onTasksChange(next)
                  toast.success("任务已删除")
                }}
                onToggleActive={(active) => handleToggleActive(index, active)}
              />
            ))}
          </div>
        )}

        {tasks.length === 0 && (
          <div className="flex flex-col items-center py-6 text-center text-muted-foreground">
            <IconClock className="size-6 stroke-1" />
            <p className="mt-1 text-xs">暂无任务</p>
            <p className="text-[10px]">点击上方「添加任务」按钮创建</p>
          </div>
        )}
      </div>

      <TaskEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        taskIndex={editIndex}
        task={editTask}
        capabilities={capabilities}
        skills={skills}
        capabilityIds={capabilityIds}
        skillIds={skillIds}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
      />
    </div>
  )
}

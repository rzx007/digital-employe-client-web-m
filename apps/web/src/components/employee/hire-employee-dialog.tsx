import * as React from "react"

import { IconLoader2, IconUserPlus } from "@tabler/icons-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { createEmployee, type RecruitmentCandidate } from "@/api/employee"
import type { ShiftScheduleForm, TaskFormData } from "@/types/task"

import { ScheduleTaskConfig } from "./schedule-task-config"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

interface HireEmployeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: RecruitmentCandidate | null
}

export function HireEmployeeDialog({
  open,
  onOpenChange,
  candidate,
}: HireEmployeeDialogProps) {
  const [name, setName] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [showScheduleAndTask, setShowScheduleAndTask] = React.useState(false)
  const [tasks, setTasks] = React.useState<TaskFormData[]>([])
  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(EMPTY_SCHEDULE)

  React.useEffect(() => {
    if (candidate && open) {
      setName(candidate.employee_name)
      setDescription(candidate.capability_desc ?? "")
      setShowScheduleAndTask(false)
      setTasks([])
      setSchedule({ ...EMPTY_SCHEDULE })
    } else if (!open) {
      setName("")
      setDescription("")
      setShowScheduleAndTask(false)
      setTasks([])
      setSchedule({ ...EMPTY_SCHEDULE })
    }
  }, [candidate, open])

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error("请输入员工名称")
      return
    }

    setIsSubmitting(true)
    try {
      await createEmployee({
        employee_name: name.trim(),
        capability_desc: description.trim() || null,
        status: 1,
        capability_ids: candidate?.capability_ids ?? [],
        skill_ids: candidate?.skill_ids ?? [],
        shift_schedule: showScheduleAndTask ? schedule : null,
        tasks: showScheduleAndTask ? tasks : [],
      })
      toast.success(`已成功录用「${name.trim()}」`)
      onOpenChange(false)
    } catch {
      toast.error("录用失败，请稍后重试")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-4 pt-5 pb-3 text-center">
          <div className="flex justify-center">
            <Avatar className="size-16 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary/10 text-sm font-medium text-primary">
                {candidate?.employee_name.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
          </div>
          <DialogTitle className="text-base">
            {candidate?.employee_name ?? "应聘者详情"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            查看详情并确认创建员工
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-4 px-4 py-3">
            {candidate && candidate.capability_desc && (
              <div className="rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">能力描述</span>
                <p className="mt-1 text-sm leading-relaxed">
                  {candidate.capability_desc}
                </p>
                {(candidate.capabilities?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {candidate.capabilities.map((cap, index) => (
                      <Badge
                        key={`${cap.capability_name}-${index}`}
                        variant="outline"
                        className="text-xs"
                      >
                        {cap.capability_name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground">
                基本信息
              </Label>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  员工名称 <span className="text-destructive">*</span>
                </Label>
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

            <div className="flex items-center justify-between">
              <Label
                htmlFor="show-schedule-task"
                className="cursor-pointer text-xs text-muted-foreground"
              >
                同时配置排班和任务
              </Label>
              <Switch
                id="show-schedule-task"
                checked={showScheduleAndTask}
                onCheckedChange={setShowScheduleAndTask}
              />
            </div>

            {showScheduleAndTask && (
              <ScheduleTaskConfig
                capabilities={candidate?.capabilities ?? []}
                capabilityIds={candidate?.capability_ids}
                skillIds={candidate?.skill_ids}
                tasks={tasks}
                schedule={schedule}
                onTasksChange={setTasks}
                onScheduleChange={setSchedule}
              />
            )}
          </div>
        </ScrollArea>

        <Separator />

        <DialogFooter className="px-4 py-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <>
                <IconLoader2 className="size-3.5 animate-spin" />
                创建中...
              </>
            ) : (
              <>
                <IconUserPlus className="size-3.5" />
                确认录用
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

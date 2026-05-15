import * as React from "react"

import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  createEmployee,
  fetchMcpList,
  type RecruitmentCandidate,
} from "@/api/employee"
import type { McpListItem } from "@/api/types"
import {
  tasksToApiPayload,
  type ScheduleTaskListItem,
  type ShiftScheduleForm,
} from "@/types/task"
import { useSkillListQuery } from "@/hooks/use-skill-queries"

import { CapabilityPickerDialog } from "./capability-picker-dialog"
import { ScheduleTaskConfig } from "./schedule-task-config"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

export function HireSheet({
  open,
  onOpenChange,
  candidate,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidate: RecruitmentCandidate
  onSuccess: () => void
}) {
  const [name, setName] = React.useState(candidate.employee_name)
  const [description, setDescription] = React.useState(
    candidate.capability_desc ?? ""
  )
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [showScheduleAndTask, setShowScheduleAndTask] = React.useState(false)
  const [tasks, setTasks] = React.useState<ScheduleTaskListItem[]>([])
  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(EMPTY_SCHEDULE)

  const [selectedMcpIds, setSelectedMcpIds] = React.useState<number[]>(
    candidate.mcp_ids ?? []
  )
  const [selectedSkillIds, setSelectedSkillIds] = React.useState<number[]>(
    candidate.skill_ids ?? []
  )
  const [allMcpList, setAllMcpList] = React.useState<McpListItem[]>([])
  const { data: allSkillList = [] } = useSkillListQuery()
  const [pickerOpen, setPickerOpen] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(candidate.employee_name)
      setDescription(candidate.capability_desc ?? "")
      setShowScheduleAndTask(false)
      setTasks([])
      setSchedule({ ...EMPTY_SCHEDULE })
      setSelectedMcpIds(candidate.mcp_ids ?? [])
      setSelectedSkillIds(candidate.skill_ids ?? [])

      fetchMcpList()
        .then(setAllMcpList)
        .catch(() => {})
    }
  }, [open, candidate])

  const selectedMcpItems = React.useMemo(
    () => allMcpList.filter((m) => selectedMcpIds.includes(m.id)),
    [allMcpList, selectedMcpIds]
  )
  const selectedSkillItems = React.useMemo(
    () => allSkillList.filter((s) => selectedSkillIds.includes(s.id)),
    [allSkillList, selectedSkillIds]
  )

  const effectiveMcpIds = React.useMemo(
    () => selectedMcpIds.filter((id) => allMcpList.some((m) => m.id === id)),
    [selectedMcpIds, allMcpList]
  )
  const effectiveSkillIds = React.useMemo(
    () => selectedSkillIds.filter((id) => allSkillList.some((s) => s.id === id)),
    [selectedSkillIds, allSkillList]
  )

  const handleRemoveMcp = (id: number) => {
    setSelectedMcpIds((prev) => prev.filter((i) => i !== id))
  }

  const handleRemoveSkill = (id: number) => {
    setSelectedSkillIds((prev) => prev.filter((i) => i !== id))
  }

  const handlePickerConfirm = (mcpIds: number[], skillIds: number[]) => {
    setSelectedMcpIds(mcpIds.filter((id) => allMcpList.some((m) => m.id === id)))
    setSelectedSkillIds(skillIds.filter((id) => allSkillList.some((s) => s.id === id)))
  }

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
        mcp_ids: effectiveMcpIds,
        skill_ids: effectiveSkillIds,
        shift_schedule: showScheduleAndTask ? schedule : null,
        tasks: showScheduleAndTask ? tasksToApiPayload(tasks) : [],
      })
      toast.success(`已成功录用「${name.trim()}」`)
      onSuccess()
    } catch {
      toast.error("录用失败，请稍后重试")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex min-h-0 w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-md"
      >
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Avatar className="size-8 rounded-lg">
              <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-medium text-primary">
                {candidate.employee_name.slice(0, 2)}
              </AvatarFallback>
            </Avatar>
            <span className="text-sm font-medium">
              {candidate.employee_name}
            </span>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-4 px-4 py-3">
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
                capabilities={candidate.mcps ?? []}
                capabilityIds={effectiveMcpIds}
                skillIds={effectiveSkillIds}
                skills={candidate.skills ?? []}
                tasks={tasks}
                schedule={schedule}
                onTasksChange={setTasks}
                onScheduleChange={setSchedule}
              />
            )}
          </div>
        </ScrollArea>

        <Separator />

        <div className="flex shrink-0 gap-2 px-4 py-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            className="flex-1 gap-1.5"
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <IconLoader2 className="size-3.5 animate-spin" />
                创建中...
              </>
            ) : (
              "确认录用"
            )}
          </Button>
        </div>
      </SheetContent>

      <CapabilityPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        allMcpList={allMcpList}
        allSkillList={allSkillList}
        selectedMcpIds={effectiveMcpIds}
        selectedSkillIds={effectiveSkillIds}
        onConfirm={handlePickerConfirm}
      />
    </Sheet>
  )
}

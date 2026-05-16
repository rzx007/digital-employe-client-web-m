import * as React from "react"

import { IconCheck, IconChevronDown, IconTool } from "@tabler/icons-react"
import { Button } from "@workspace/ui/components/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
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
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import {
  WheelPicker,
  WheelPickerWrapper,
  type WheelPickerOption,
} from "@workspace/ui/components/wheel-picker"
import type { MetadataMcp, MetadataSkill } from "@/api/types"
import { cn } from "@workspace/ui/lib/utils"
import {
  executeTimeToCronExpression,
  parseCronToExecuteTime,
} from "@/lib/cron-utils"
import type { CronExpressionType, TaskFormData } from "@/types/task"

const SCHEDULE_TYPE_OPTIONS: { value: CronExpressionType; label: string }[] = [
  { value: "daily", label: "每天" },
  { value: "weekdays", label: "周一到周五" },
  { value: "weekends", label: "周六到周日" },
  { value: "loop", label: "循环" },
]

const LOOP_INTERVAL_OPTIONS = [
  { value: "1分钟", label: "1分钟" },
  { value: "5分钟", label: "5分钟" },
  { value: "15分钟", label: "15分钟" },
  { value: "30分钟", label: "30分钟" },
  { value: "1小时", label: "1小时" },
  { value: "2小时", label: "2小时" },
  { value: "4小时", label: "4小时" },
  { value: "6小时", label: "6小时" },
  { value: "12小时", label: "12小时" },
]

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

function splitExecuteTime(executeTime: string | null | undefined): {
  hour: string
  minute: string
} {
  const matched = executeTime?.match(/^(\d{1,2}):(\d{1,2})$/)
  if (!matched) {
    return { hour: "00", minute: "00" }
  }

  const hour = Math.min(23, Math.max(0, Number(matched[1])))
  const minute = Math.min(59, Math.max(0, Number(matched[2])))
  return { hour: pad2(hour), minute: pad2(minute) }
}

function buildExecuteTime(hour: string, minute: string): string {
  const hourNum = Math.min(23, Math.max(0, Number(hour)))
  const minuteNum = Math.min(59, Math.max(0, Number(minute)))
  return `${pad2(hourNum)}:${pad2(minuteNum)}`
}

function createEmptyTask(): TaskFormData {
  return {
    task_name: "",
    user_prompt: "",
    task_resource_type: "mcp",
    capability_id: 0,
    skill_id: 0,
    task_type: 2,
    cron_expression: "",
    cron_expression_type: "daily",
    is_active: true,
    excludedDates: [],
    executeTime: "",
    confirm_execution_result: false,
  }
}

function taskFromExisting(task: TaskFormData): TaskFormData {
  return {
    ...task,
    executeTime:
      parseCronToExecuteTime(task.cron_expression) || task.executeTime,
  }
}

interface TaskEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskIndex: number | null
  task: TaskFormData | null
  capabilities: MetadataMcp[]
  skills: MetadataSkill[]
  capabilityIds?: number[]
  skillIds?: number[]
  onSave: (task: TaskFormData) => void
  onDelete: () => void
}

export function TaskEditDialog({
  open,
  onOpenChange,
  taskIndex,
  task,
  capabilities,
  skills,
  capabilityIds,
  skillIds,
  onSave,
  onDelete,
}: TaskEditDialogProps) {
  const [formData, setFormData] = React.useState<TaskFormData>(createEmptyTask)
  const [capabilityOpen, setCapabilityOpen] = React.useState(false)
  const [timePickerOpen, setTimePickerOpen] = React.useState(false)
  const [pickerTab, setPickerTab] = React.useState<"mcp" | "skill">("skill")
  const [advancedOpen, setAdvancedOpen] = React.useState(false)

  const filteredCapabilities = React.useMemo(() => {
    if (!capabilityIds?.length) return capabilities
    return capabilities.filter((c) => capabilityIds.includes(c.id))
  }, [capabilities, capabilityIds])

  const filteredSkills = React.useMemo(() => {
    const list = skills
    if (!skillIds?.length) return list
    return list.filter((s) => skillIds.includes(Number(s.id)))
  }, [skills, skillIds])

  const isLoopMode = formData.cron_expression_type === "loop"
  const selectedCapability = React.useMemo(
    () =>
      formData.task_resource_type === "mcp"
        ? (filteredCapabilities.find((c) => c.id === formData.capability_id) ??
          null)
        : null,
    [formData.task_resource_type, formData.capability_id, filteredCapabilities]
  )
  const selectedSkill = React.useMemo(
    () =>
      formData.task_resource_type === "skill"
        ? (filteredSkills.find((s) => Number(s.id) === formData.skill_id) ??
          null)
        : null,
    [formData.task_resource_type, formData.skill_id, filteredSkills]
  )
  const timeValue = React.useMemo(
    () => splitExecuteTime(formData.executeTime),
    [formData.executeTime]
  )
  const hourOptions = React.useMemo<WheelPickerOption[]>(
    () =>
      Array.from({ length: 24 }, (_, idx) => {
        const value = pad2(idx)
        return { label: value, value }
      }),
    []
  )
  const minuteOptions = React.useMemo<WheelPickerOption[]>(
    () =>
      Array.from({ length: 60 }, (_, idx) => {
        const value = pad2(idx)
        return { label: value, value }
      }),
    []
  )

  const dialogTitle = taskIndex !== null ? "编辑任务" : "新增任务"

  React.useEffect(() => {
    if (open) {
      const initial = task ? taskFromExisting(task) : createEmptyTask()
      setFormData(initial)
      setPickerTab(initial.task_resource_type === "mcp" ? "mcp" : "skill")
      setCapabilityOpen(false)
      setTimePickerOpen(false)
      setAdvancedOpen(false)
    }
  }, [open, task])

  const updateField = <K extends keyof TaskFormData>(
    key: K,
    value: TaskFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (!formData.task_name.trim() || !formData.user_prompt.trim()) return

    const saved: TaskFormData = {
      id: formData.id,
      task_name: formData.task_name.trim(),
      user_prompt: formData.user_prompt.trim(),
      task_resource_type: formData.task_resource_type,
      capability_id:
        formData.task_resource_type === "skill" ? 0 : formData.capability_id,
      skill_id: formData.task_resource_type === "skill" ? formData.skill_id : 0,
      task_type: formData.task_type ?? 2,
      cron_expression:
        executeTimeToCronExpression(
          formData.executeTime,
          formData.cron_expression_type
        ) || "",
      cron_expression_type: formData.cron_expression_type || "daily",
      is_active: formData.is_active ?? true,
      excludedDates: formData.excludedDates,
      executeTime: formData.executeTime,
      confirm_execution_result: formData.confirm_execution_result ?? false,
    }
    onSave(saved)
  }

  const isValid =
    formData.task_name.trim() !== "" &&
    formData.user_prompt.trim() !== "" &&
    (isLoopMode || !!formData.executeTime?.trim())

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>配置任务的执行参数和能力绑定</DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label className="text-xs">
              任务名称 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="请输入任务名称"
              value={formData.task_name}
              onChange={(e) => updateField("task_name", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              用户的问题 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="请输入用户的问题（发送给 AI/Skill 的 prompt）"
              value={formData.user_prompt}
              onChange={(e) => updateField("user_prompt", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">能力（可选）</Label>
            <Popover open={capabilityOpen} onOpenChange={setCapabilityOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-auto w-full justify-start overflow-hidden py-2"
                >
                  {selectedSkill ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted">
                        <IconTool className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-medium">
                          {selectedSkill.skillName}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {selectedSkill.description}
                        </div>
                      </div>
                    </div>
                  ) : selectedCapability ? (
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted">
                        <IconTool className="size-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-medium">
                          {selectedCapability.capability_name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {selectedCapability.capability_desc}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">选择能力...</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[400px] p-0" align="start">
                <Tabs
                  value={pickerTab}
                  onValueChange={(v) => setPickerTab(v as "mcp" | "skill")}
                >
                  <TabsList className="grid h-9 w-full grid-cols-2 rounded-none rounded-t-lg border-b">
                    <TabsTrigger value="skill" className="rounded-none">
                      技能
                    </TabsTrigger>
                    <TabsTrigger value="mcp" className="rounded-none">
                      MCP 工具
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="mcp" className="mt-0 outline-none">
                    <Command>
                      <CommandInput placeholder="搜索 MCP 工具..." />
                      <CommandList>
                        <CommandEmpty>没有找到匹配的工具</CommandEmpty>
                        <CommandGroup>
                          {filteredCapabilities.map((cap) => (
                            <CommandItem
                              key={cap.id}
                              value={`${cap.capability_name}-${cap.capability_desc}`}
                              onSelect={() => {
                                const nextId =
                                  formData.capability_id === cap.id ? 0 : cap.id
                                setFormData((prev) => ({
                                  ...prev,
                                  task_resource_type: "mcp",
                                  skill_id: 0,
                                  capability_id: nextId,
                                }))
                                setCapabilityOpen(false)
                              }}
                            >
                              <div className="flex w-full items-center gap-3 py-1">
                                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted">
                                  <IconTool className="size-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {cap.capability_name}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {cap.capability_desc}
                                  </div>
                                </div>
                                <IconCheck
                                  className={cn(
                                    "size-4 shrink-0",
                                    formData.task_resource_type === "mcp" &&
                                      formData.capability_id === cap.id
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </TabsContent>
                  <TabsContent value="skill" className="mt-0 outline-none">
                    <Command>
                      <CommandInput placeholder="搜索技能..." />
                      <CommandList>
                        <CommandEmpty>没有找到匹配的技能</CommandEmpty>
                        <CommandGroup>
                          {filteredSkills.map((skill) => (
                            <CommandItem
                              key={String(skill.id)}
                              value={`${skill.id}-${skill.skillName}-${skill.description}`}
                              onSelect={() => {
                                const numId = Number(skill.id)
                                const nextId =
                                  formData.skill_id === numId ? 0 : numId
                                setFormData((prev) => ({
                                  ...prev,
                                  capability_id: 0,
                                  skill_id: nextId,
                                  task_resource_type: nextId ? "skill" : "mcp",
                                }))
                                setCapabilityOpen(false)
                              }}
                            >
                              <div className="flex w-full items-center gap-3 py-1">
                                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted">
                                  <IconTool className="size-4 text-muted-foreground" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-medium">
                                    {skill.skillName}
                                  </div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {skill.description}
                                  </div>
                                </div>
                                <IconCheck
                                  className={cn(
                                    "size-4 shrink-0",
                                    formData.task_resource_type === "skill" &&
                                      formData.skill_id === Number(skill.id)
                                      ? "opacity-100"
                                      : "opacity-0"
                                  )}
                                />
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </TabsContent>
                </Tabs>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">排班频率</Label>
            <div className="flex flex-wrap gap-3">
              {SCHEDULE_TYPE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
                    formData.cron_expression_type === option.value
                      ? "border-primary bg-primary/5 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent/50"
                  )}
                >
                  <input
                    type="radio"
                    name="cronType"
                    value={option.value}
                    checked={formData.cron_expression_type === option.value}
                    onChange={() =>
                      updateField("cron_expression_type", option.value)
                    }
                    className="sr-only"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              执行时间 <span className="text-destructive">*</span>
            </Label>
            {isLoopMode ? (
              <Select
                value={formData.executeTime}
                onValueChange={(v) => updateField("executeTime", v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="请选择循环间隔" />
                </SelectTrigger>
                <SelectContent>
                  {LOOP_INTERVAL_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Popover open={timePickerOpen} onOpenChange={setTimePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between font-normal"
                  >
                    <span>{formData.executeTime || "请选择执行时间"}</span>
                    <IconChevronDown className="size-4 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="w-56 border-none bg-transparent p-0 shadow-none"
                >
                  <WheelPickerWrapper>
                    <WheelPicker
                      options={hourOptions}
                      value={timeValue.hour}
                      onValueChange={(hour) =>
                        updateField(
                          "executeTime",
                          buildExecuteTime(String(hour), timeValue.minute)
                        )
                      }
                    />
                    <WheelPicker
                      options={minuteOptions}
                      value={timeValue.minute}
                      onValueChange={(minute) =>
                        updateField(
                          "executeTime",
                          buildExecuteTime(timeValue.hour, String(minute))
                        )
                      }
                    />
                  </WheelPickerWrapper>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
            <div className="space-y-0.5">
              <Label className="text-sm">启用此任务</Label>
              <p className="text-xs text-muted-foreground">是否启用此任务</p>
            </div>
            <Switch
              checked={formData.is_active}
              onCheckedChange={(v) => updateField("is_active", v)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
            <div className="space-y-0.5">
              <Label className="text-sm">执行结果确认通知</Label>
              <p className="text-xs text-muted-foreground">
                任务执行完成后发送确认通知
              </p>
            </div>
            <Switch
              checked={formData.confirm_execution_result ?? false}
              onCheckedChange={(v) =>
                updateField("confirm_execution_result", v)
              }
            />
          </div>

          <Separator />

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between text-xs text-muted-foreground"
              >
                <span className="flex items-center gap-2 font-light text-primary/80">
                  <IconChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      advancedOpen && "rotate-180"
                    )}
                  />
                  高级选项
                </span>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">排除日期</Label>
                <Input
                  placeholder="排除日期（如：2026-05-01,2026-05-02）"
                  value={formData.excludedDates?.join(",") ?? ""}
                  onChange={(e) => {
                    const val = e.target.value
                    updateField(
                      "excludedDates",
                      val.trim() ? val.split(",").map((s) => s.trim()) : []
                    )
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  用逗号分隔多个日期（YYYY-MM-DD）
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
          {/* {JSON.stringify(formData)} */}
        </div>

        <Separator />

        <DialogFooter className="flex items-center px-5 py-3">

          {taskIndex !== null && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              删除
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {taskIndex !== null ? "保存" : "添加任务"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

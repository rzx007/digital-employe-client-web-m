import * as React from "react"

import { useNavigate } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconSparkles,
  IconUserPlus,
} from "@tabler/icons-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  fetchRecruitCandidates,
  type RecruitmentCandidate,
} from "@/api/employee"
import { cn } from "@workspace/ui/lib/utils"

function getMatchScoreColor(score: number) {
  if (score >= 80) return "text-green-600 dark:text-green-400"
  if (score >= 60) return "text-blue-600 dark:text-blue-400"
  if (score >= 40) return "text-yellow-600 dark:text-yellow-400"
  return "text-gray-600 dark:text-gray-400"
}

function getMatchScoreLabel(score: number) {
  if (score >= 80) return "极佳匹配"
  if (score >= 60) return "良好匹配"
  if (score >= 40) return "一般匹配"
  return "较低匹配"
}

function getProgressColor(score: number) {
  if (score >= 80) return "bg-green-500"
  if (score >= 60) return "bg-blue-500"
  if (score >= 40) return "bg-yellow-500"
  return "bg-gray-400"
}

function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: RecruitmentCandidate
  onSelect: (candidate: RecruitmentCandidate) => void
}) {
  const [expanded, setExpanded] = React.useState(false)

  const displayCapabilities = candidate.capabilities?.slice(0, 2) ?? []
  const displaySkills = candidate.skills?.slice(0, 2) ?? []
  const remainingCapCount =
    (candidate.capabilities?.length ?? 0) - displayCapabilities.length
  const remainingSkillCount =
    (candidate.skills?.length ?? 0) - displaySkills.length
  const matchScore = candidate.match_score ?? 0

  return (
    <div className="rounded-md border transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3 p-3">
        <Avatar className="size-10 shrink-0 rounded-lg">
          <AvatarFallback className="rounded-lg bg-primary/10 text-xs font-medium text-primary">
            {candidate.employee_name.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {candidate.employee_name}
            </span>
            {matchScore > 0 && (
              <div className="flex shrink-0 items-center gap-1">
                <span
                  className={cn(
                    "text-xs font-semibold",
                    getMatchScoreColor(matchScore)
                  )}
                >
                  {matchScore}%
                </span>
                <Badge
                  variant={matchScore >= 60 ? "default" : "secondary"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {getMatchScoreLabel(matchScore)}
                </Badge>
              </div>
            )}
          </div>

          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {candidate.capability_desc || "暂无描述"}
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {displayCapabilities.map((cap, index) => (
              <Badge
                key={`cap-${cap.capability_name}-${index}`}
                variant="secondary"
                className="text-[10px]"
              >
                {cap.capability_name}
              </Badge>
            ))}
            {remainingCapCount > 0 && (
              <Badge
                variant="secondary"
                className="text-[10px] text-muted-foreground"
              >
                +{remainingCapCount} MCP
              </Badge>
            )}
            {displaySkills.map((skill, index) => (
              <Badge
                key={`skill-${skill.id}-${index}`}
                variant="outline"
                className="text-[10px]"
              >
                {skill.skillName}
              </Badge>
            ))}
            {remainingSkillCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                +{remainingSkillCount} 技能
              </Badge>
            )}
          </div>

          {matchScore > 0 && (
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  getProgressColor(matchScore)
                )}
                style={{ width: `${matchScore}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <Separator />

      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="flex items-center py-1">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex flex-1 items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent/50"
            >
              {expanded ? (
                <IconChevronDown className="size-3" />
              ) : (
                <IconChevronRight className="size-3" />
              )}
              查看能力详情
            </button>
          </CollapsibleTrigger>
          <Button
            size="xs"
            className="mr-2 gap-1"
            onClick={() => onSelect(candidate)}
          >
            <IconUserPlus className="size-3" />
            选择该应聘者
          </Button>
        </div>
        <CollapsibleContent>
          <div className="space-y-1.5 border-t px-3 py-2">
            {candidate.capabilities?.map((cap, index) => (
              <div key={`cap-detail-${index}`} className="text-xs">
                <span className="font-medium">MCP: {cap.capability_name}</span>
                <p className="leading-relaxed text-muted-foreground">
                  {cap.capability_desc}
                </p>
              </div>
            ))}
            {candidate.skills?.map((skill, index) => (
              <div key={`skill-detail-${index}`} className="text-xs">
                <span className="font-medium">技能: {skill.skillName}</span>
                <p className="leading-relaxed text-muted-foreground">
                  {skill.description}
                </p>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function RecruitmentPage() {
  const navigate = useNavigate()
  const isElectron = !!(typeof window !== "undefined" && window.electronApi)
  const [title, setTitle] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [candidates, setCandidates] = React.useState<RecruitmentCandidate[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [selectedCandidate, setSelectedCandidate] =
    React.useState<RecruitmentCandidate | null>(null)

  const handleSearch = async () => {
    // if (!title.trim()) return
    setIsSearching(true)
    setHasSearched(false)
    setCandidates([])

    try {
      const result = await fetchRecruitCandidates({
        title: title.trim(),
        prompt: prompt.trim(),
        count: Math.floor(Math.random() * 4) + 3,
      })
      setCandidates(result)
    } catch {
      toast.error("匹配失败，请稍后重试")
    } finally {
      setIsSearching(false)
      setHasSearched(true)
    }
  }

  const handleSelectCandidate = (candidate: RecruitmentCandidate) => {
    setSelectedCandidate(candidate)
  }

  const handleCloseSheet = () => {
    setSelectedCandidate(null)
  }

  const handleHireSuccess = () => {
    setSelectedCandidate(null)
    setTitle("")
    setPrompt("")
    setCandidates([])
    setHasSearched(false)
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {!isElectron && (
        <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => navigate({ to: "/" })}
          >
            <IconArrowLeft className="size-4" />
          </Button>
          <h1 className="text-lg font-semibold">招聘大厅</h1>
        </div>
      )}
      {isElectron && (
        <div className="shrink-0 border-b px-4 py-3">
          <h1 className="text-lg font-semibold">招聘大厅</h1>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-6">
          <div className="space-y-3">
            {/* <div className="space-y-1.5">
              <Label className="text-xs">
                招聘标题 <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="例如：招聘客服助手"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isSearching}
              />
            </div> */}
            <div className="space-y-1.5">
              <Label className="text-xs">岗位描述</Label>
              <Textarea
                className="min-h-20 resize-none"
                placeholder="描述该岗位的工作职责和要求..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isSearching}
              />
            </div>
            <Button
              size="sm"
              className="w-full gap-1.5"
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? (
                <>
                  <Spinner className="size-3.5" />
                  正在匹配最佳应聘者...
                </>
              ) : (
                <>
                  <IconSparkles className="size-3.5" />
                  发布招聘
                </>
              )}
            </Button>
          </div>

          {hasSearched && (
            <>
              <Separator className="my-4" />
              <div className="mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  推荐应聘者 ({candidates.length})
                </span>
              </div>
            </>
          )}

          {isSearching && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-md border p-3">
                <Skeleton className="size-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-md border p-3">
                <Skeleton className="size-10 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            </div>
          )}

          {hasSearched && candidates.length > 0 && (
            <div className="space-y-4">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onSelect={handleSelectCandidate}
                />
              ))}
            </div>
          )}

          {hasSearched && candidates.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
              <IconSparkles className="size-8 stroke-1" />
              <p className="mt-2 text-xs">暂未找到匹配的应聘者</p>
              <p className="text-xs">请尝试调整招聘标题或岗位描述</p>
            </div>
          )}
        </div>
      </div>

      {selectedCandidate && (
        <HireSheet
          open={!!selectedCandidate}
          onOpenChange={(open) => {
            if (!open) handleCloseSheet()
          }}
          candidate={selectedCandidate}
          onSuccess={handleHireSuccess}
        />
      )}
    </div>
  )
}

import { Sheet, SheetContent } from "@workspace/ui/components/sheet"
import { IconLoader2, IconX } from "@tabler/icons-react"
import { Switch } from "@workspace/ui/components/switch"
import { createEmployee } from "@/api/employee"
import { ScheduleTaskConfig } from "./schedule-task-config"
import type { ShiftScheduleForm, TaskFormData } from "@/types/task"

const EMPTY_SCHEDULE: ShiftScheduleForm = {
  start_date: "",
  end_date: "",
  status: 1,
  notes: "",
}

function HireSheet({
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
  const [tasks, setTasks] = React.useState<TaskFormData[]>([])
  const [schedule, setSchedule] =
    React.useState<ShiftScheduleForm>(EMPTY_SCHEDULE)

  React.useEffect(() => {
    if (open) {
      setName(candidate.employee_name)
      setDescription(candidate.capability_desc ?? "")
      setShowScheduleAndTask(false)
      setTasks([])
      setSchedule({ ...EMPTY_SCHEDULE })
    }
  }, [open, candidate])

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
        capability_ids: candidate.capability_ids ?? [],
        skill_ids: candidate.skill_ids ?? [],
        skills: candidate.skills ?? [],
        shift_schedule: showScheduleAndTask ? schedule : null,
        tasks: showScheduleAndTask ? tasks : [],
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
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
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => onOpenChange(false)}
          >
            <IconX className="size-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-4 px-4 py-3">
            {candidate.capability_desc && (
              <div className="rounded-lg bg-muted/50 p-3">
                <span className="text-xs text-muted-foreground">能力描述</span>
                <p className="mt-1 text-sm leading-relaxed">
                  {candidate.capability_desc}
                </p>
                {(candidate.capabilities?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      MCP:
                    </span>
                    {candidate.capabilities.map((cap, index) => (
                      <Badge
                        key={`cap-${index}`}
                        variant="secondary"
                        className="text-xs"
                      >
                        {cap.capability_name}
                      </Badge>
                    ))}
                  </div>
                )}
                {(candidate.skills?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-muted-foreground">
                      技能:
                    </span>
                    {candidate.skills.map((skill, index) => (
                      <Badge
                        key={`skill-${index}`}
                        variant="outline"
                        className="text-xs"
                      >
                        {skill.skillName}
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
                capabilities={candidate.capabilities ?? []}
                capabilityIds={candidate.capability_ids}
                skillIds={candidate.skill_ids}
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
    </Sheet>
  )
}

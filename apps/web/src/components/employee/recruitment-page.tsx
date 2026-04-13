import * as React from "react"

import { useNavigate } from "@tanstack/react-router"
import {
  IconArrowLeft,
  IconChevronDown,
  IconChevronRight,
  IconSparkles,
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

const HOT_JOBS = [
  "客服助手",
  "数据分析师",
  "运维工程师",
  "测试工程师",
  "内容运营",
  "HR助手",
  "财务助手",
  "行政助理",
]

const DEMO_CANDIDATES: RecruitmentCandidate[] = [
  {
    id: 9991,
    workspace_id: null,
    employee_name: "智能客服助手",
    capability_desc:
      "熟练掌握多轮对话、意图识别、知识库问答，能够高效处理客户咨询，提供7×24小时不间断服务。",
    status: 1,
    detail_page_url: null,
    created_at: "",
    updated_at: "",
    user_id: null,
    capability_ids: [1, 2, 3],
    skill_ids: [1],
    capabilities: [
      {
        capability_name: "客服对话",
        capability_desc: "多轮对话管理",
        mcp_server_name: "customer-service",
        mcp_tool_name: "chat",
      },
      {
        capability_name: "意图识别",
        capability_desc: "用户意图分析",
        mcp_server_name: "nlp",
        mcp_tool_name: "intent",
      },
      {
        capability_name: "知识库管理",
        capability_desc: "知识库查询与更新",
        mcp_server_name: "knowledge",
        mcp_tool_name: "query",
      },
    ],
    skills: [
      {
        id: 1,
        skillName: "FAQ自动回复",
        description: "常见问题自动回答",
        prompt: "",
        directoryId: null,
        status: 1,
        createTime: "",
        updateTime: "",
        directoryName: null,
      },
    ],
    shift_schedule: null,
    tasks: [],
    match_score: 95,
  },
  {
    id: 9992,
    workspace_id: null,
    employee_name: "数据分析师",
    capability_desc:
      "擅长数据清洗、统计分析、可视化报表生成，能够从海量数据中挖掘业务洞察，提供决策支持。",
    status: 1,
    detail_page_url: null,
    created_at: "",
    updated_at: "",
    user_id: null,
    capability_ids: [4, 5],
    skill_ids: [2],
    capabilities: [
      {
        capability_name: "数据处理",
        capability_desc: "ETL数据清洗",
        mcp_server_name: "data",
        mcp_tool_name: "clean",
      },
      {
        capability_name: "可视化",
        capability_desc: "报表生成",
        mcp_server_name: "chart",
        mcp_tool_name: "render",
      },
    ],
    skills: [
      {
        id: 2,
        skillName: "SQL查询",
        description: "数据库查询分析",
        prompt: "",
        directoryId: null,
        status: 1,
        createTime: "",
        updateTime: "",
        directoryName: null,
      },
    ],
    shift_schedule: null,
    tasks: [],
    match_score: 88,
  },
  {
    id: 9993,
    workspace_id: null,
    employee_name: "运维工程师",
    capability_desc:
      "熟悉系统监控、日志分析、自动化运维，能够快速定位故障，保障服务稳定运行。",
    status: 1,
    detail_page_url: null,
    created_at: "",
    updated_at: "",
    user_id: null,
    capability_ids: [6, 7],
    skill_ids: [3],
    capabilities: [
      {
        capability_name: "系统监控",
        capability_desc: "服务状态监控",
        mcp_server_name: "monitor",
        mcp_tool_name: "check",
      },
      {
        capability_name: "日志分析",
        capability_desc: "日志检索分析",
        mcp_server_name: "logger",
        mcp_tool_name: "search",
      },
    ],
    skills: [
      {
        id: 3,
        skillName: "自动化脚本",
        description: "批量任务自动化",
        prompt: "",
        directoryId: null,
        status: 1,
        createTime: "",
        updateTime: "",
        directoryName: null,
      },
    ],
    shift_schedule: null,
    tasks: [],
    match_score: 82,
  },
]

function getMatchScoreColor(score: number) {
  if (score >= 90) return "text-green-600 dark:text-green-400"
  if (score >= 70) return "text-blue-600 dark:text-blue-400"
  if (score >= 50) return "text-yellow-600 dark:text-yellow-400"
  return "text-gray-600 dark:text-gray-400"
}

function getMatchScoreLabel(score: number) {
  if (score >= 90) return "极佳匹配"
  if (score >= 70) return "良好匹配"
  if (score >= 50) return "一般匹配"
  return "较低匹配"
}

function getProgressColor(score: number) {
  if (score >= 90) return "bg-green-500"
  if (score >= 70) return "bg-blue-500"
  if (score >= 50) return "bg-yellow-500"
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
        <div className="flex items-center">
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
            variant="ghost"
            size="xs"
            className="mr-2 gap-1"
            onClick={() => onSelect(candidate)}
          >
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
  const [prompt, setPrompt] = React.useState("")
  const [candidates, setCandidates] = React.useState<RecruitmentCandidate[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)
  const [selectedCandidate, setSelectedCandidate] =
    React.useState<RecruitmentCandidate | null>(null)

  const handleSearch = async () => {
    setIsSearching(true)
    setHasSearched(true)

    try {
      const result = await fetchRecruitCandidates({
        title: "数字员工",
        prompt: prompt.trim(),
        count: 6,
      })
      setCandidates(result)
    } catch {
      toast.error("匹配失败，请稍后重试")
    } finally {
      setIsSearching(false)
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
    setPrompt("")
    setCandidates([])
    setHasSearched(false)
  }

  const displayCandidates = hasSearched ? candidates : DEMO_CANDIDATES

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
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
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  🔥 热门推荐
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {HOT_JOBS.map((job) => (
                  <Button
                    key={job}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setPrompt(`招聘${job}`)}
                  >
                    {job}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  📝 描述您的招聘需求
                </span>
              </div>
              <Textarea
                className="min-h-20 resize-none"
                placeholder="例如：需要一个能处理客户咨询、解答产品问题的数字员工..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={isSearching}
              />
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
          </div>

          <Separator className="my-6" />

          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">
                💡 {hasSearched ? "为您推荐" : "为您智能推荐"}
              </span>
              <span className="text-xs text-muted-foreground">
                ({displayCandidates.length})
              </span>
            </div>

            {isSearching && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 rounded-md border p-4">
                  <Skeleton className="size-10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-md border p-4">
                  <Skeleton className="size-10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              </div>
            )}

            {!isSearching && (
              <div className="space-y-3">
                {displayCandidates.map((candidate) => (
                  <CandidateCard
                    key={candidate.id}
                    candidate={candidate}
                    onSelect={handleSelectCandidate}
                  />
                ))}
              </div>
            )}

            {hasSearched && !isSearching && candidates.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                <IconSparkles className="size-8 stroke-1" />
                <p className="mt-2 text-xs">暂未找到匹配的应聘者</p>
                <p className="text-xs">请尝试调整招聘需求描述</p>
              </div>
            )}

            {!hasSearched && (
              <p className="text-xs text-muted-foreground">
                点击上方热门推荐或输入描述，开始匹配数字员工
              </p>
            )}
          </div>
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
import { IconLoader2, IconX, IconPlus, IconCheck } from "@tabler/icons-react"
import { Switch } from "@workspace/ui/components/switch"
import { Label } from "@workspace/ui/components/label"
import { createEmployee, fetchMcps, fetchSkills, type McpItem, type SkillItem } from "@/api/employee"
import { ScheduleTaskConfig } from "./schedule-task-config"
import type { ShiftScheduleForm, TaskFormData } from "@/types/task"
import type { Capability, MetadataSkill } from "@/api/types"

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
  const [availableMcps, setAvailableMcps] = React.useState<McpItem[]>([])
  const [availableSkills, setAvailableSkills] = React.useState<SkillItem[]>([])
  const [selectedMcps, setSelectedMcps] = React.useState<Capability[]>([])
  const [selectedSkills, setSelectedSkills] = React.useState<MetadataSkill[]>([])
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName(candidate.employee_name)
      setDescription(candidate.capability_desc ?? "")
      setShowScheduleAndTask(false)
      setTasks([])
      setSchedule({ ...EMPTY_SCHEDULE })
      setSelectedMcps(candidate.capabilities ?? [])
      setSelectedSkills(candidate.skills ?? [])
      setIsLoadingOptions(true)
      Promise.all([fetchMcps(), fetchSkills()])
        .then(([mcps, skills]) => {
          setAvailableMcps(mcps)
          setAvailableSkills(skills)
        })
        .finally(() => setIsLoadingOptions(false))
    }
  }, [open, candidate])

  const toggleMcp = (mcp: McpItem) => {
    const exists = selectedMcps.find(
      (m) => m.mcp_tool_name === mcp.mcp_tool_name
    )
    if (exists) {
      setSelectedMcps(selectedMcps.filter((m) => m.mcp_tool_name !== mcp.mcp_tool_name))
    } else {
      setSelectedMcps([
        ...selectedMcps,
        {
          capability_name: mcp.capability_name,
          capability_desc: mcp.capability_desc,
          mcp_server_name: mcp.mcp_server_name,
          mcp_tool_name: mcp.mcp_tool_name,
          id: mcp.id,
        },
      ])
    }
  }

  const toggleSkill = (skill: SkillItem) => {
    const exists = selectedSkills.find((s) => s.id === skill.id)
    if (exists) {
      setSelectedSkills(selectedSkills.filter((s) => s.id !== skill.id))
    } else {
      setSelectedSkills([
        ...selectedSkills,
        {
          id: skill.id,
          skillName: skill.skillName,
          description: skill.description,
          prompt: skill.prompt,
          directoryId: skill.directoryId,
          status: skill.status,
          createTime: skill.createTime,
          updateTime: skill.updateTime,
          directoryName: skill.directoryName,
        },
      ])
    }
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
        capability_ids: selectedMcps.map((m) => m.id ?? 0),
        skill_ids: selectedSkills.map((s) => s.id),
        skills: selectedSkills,
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
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md min-h-0 overflow-y-auto"
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
                MCP 能力 (已选 {selectedMcps.length})
              </Label>
              {isLoadingOptions ? (
                <div className="text-xs text-muted-foreground">加载中...</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableMcps.map((mcp) => {
                    const isSelected = selectedMcps.some(
                      (m) => m.mcp_tool_name === mcp.mcp_tool_name
                    )
                    return (
                      <Button
                        key={mcp.id}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        className="h-6 gap-1 text-xs"
                        onClick={() => toggleMcp(mcp)}
                      >
                        {isSelected && <IconCheck className="size-3" />}
                        {mcp.capability_name}
                      </Button>
                    )
                  })}
                  {availableMcps.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      暂无可用 MCP
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-medium text-muted-foreground">
                技能 (已选 {selectedSkills.length})
              </Label>
              {isLoadingOptions ? (
                <div className="text-xs text-muted-foreground">加载中...</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableSkills.map((skill) => {
                    const isSelected = selectedSkills.some(
                      (s) => s.id === skill.id
                    )
                    return (
                      <Button
                        key={skill.id}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        className="h-6 gap-1 text-xs"
                        onClick={() => toggleSkill(skill)}
                      >
                        {isSelected && <IconCheck className="size-3" />}
                        {skill.skillName}
                      </Button>
                    )
                  })}
                  {availableSkills.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      暂无可用技能
                    </span>
                  )}
                </div>
              )}
            </div>

            <Separator />

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
                capabilities={selectedMcps}
                capabilityIds={selectedMcps.map((m) => m.id ?? 0)}
                skillIds={selectedSkills.map((s) => s.id)}
                skills={selectedSkills}
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

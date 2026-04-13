import * as React from "react"

import { useNavigate } from "@tanstack/react-router"
import { IconArrowLeft, IconSparkles } from "@tabler/icons-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  fetchRecruitCandidates,
  type RecruitmentCandidate,
} from "@/api/employee"

import { CandidateCard } from "./candidate-card"
import { HireSheet } from "./hire-sheet"

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
        prompt: prompt.trim(),
        count: 1,
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

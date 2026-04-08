import * as React from "react"

import {
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
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

  const displayCapabilities = candidate.capabilities?.slice(0, 3) ?? []
  const remainingCount =
    (candidate.capabilities?.length ?? 0) - displayCapabilities.length

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
            <div className="flex shrink-0 items-center gap-1">
              <span
                className={cn(
                  "text-xs font-semibold",
                  getMatchScoreColor(candidate.match_score)
                )}
              >
                {candidate.match_score}%
              </span>
              <Badge
                variant={candidate.match_score >= 60 ? "default" : "secondary"}
                className="px-1.5 py-0 text-[10px]"
              >
                {getMatchScoreLabel(candidate.match_score)}
              </Badge>
            </div>
          </div>

          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {candidate.capability_desc || "暂无描述"}
          </p>

          <div className="mt-2 flex flex-wrap gap-1">
            {displayCapabilities.map((cap, index) => (
              <Badge
                key={`${cap.capability_name}-${index}`}
                variant="outline"
                className="text-[10px]"
              >
                {cap.capability_name}
              </Badge>
            ))}
            {remainingCount > 0 && (
              <Badge
                variant="outline"
                className="text-[10px] text-muted-foreground"
              >
                +{remainingCount}
              </Badge>
            )}
          </div>

          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                getProgressColor(candidate.match_score)
              )}
              style={{ width: `${candidate.match_score}%` }}
            />
          </div>
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
            <IconUserPlus className="size-3" />
            选择该应聘者
          </Button>
        </div>
        <CollapsibleContent>
          <div className="space-y-1.5 border-t px-3 py-2">
            {candidate.capabilities?.map((cap, index) => (
              <div key={`${cap.capability_name}-${index}`} className="text-xs">
                <span className="font-medium">{cap.capability_name}</span>
                <p className="leading-relaxed text-muted-foreground">
                  {cap.capability_desc}
                </p>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

interface RecruitmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelectCandidate?: (candidate: RecruitmentCandidate) => void
}

export function RecruitmentDialog({
  open,
  onOpenChange,
  onSelectCandidate,
}: RecruitmentDialogProps) {
  const [title, setTitle] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [candidates, setCandidates] = React.useState<RecruitmentCandidate[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)

  const handleSearch = async () => {
    if (!title.trim()) return
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

  const handleSelect = (candidate: RecruitmentCandidate) => {
    onSelectCandidate?.(candidate)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTitle("")
      setPrompt("")
      setCandidates([])
      setHasSearched(false)
      setIsSearching(false)
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <IconSparkles className="size-4 text-primary" />
            招聘数字员工
          </DialogTitle>
          <DialogDescription>
            创建招聘需求，系统将根据描述智能推荐最匹配的数字员工
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-3 px-4 py-3">
          <div className="space-y-1.5">
            <Label className="text-xs">
              招聘标题 <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="例如：招聘客服助手"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSearching}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">岗位描述</Label>
            <Textarea
              className="min-h-20 resize-none"
              placeholder="描述该岗位的工作职责和要求，系统将根据描述智能推荐合适的应聘者..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isSearching}
            />
            <p className="text-[10px] text-muted-foreground">
              系统将根据标题和描述自动生成所需能力，并推荐匹配的应聘者
            </p>
          </div>
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={handleSearch}
            disabled={!title.trim() || isSearching}
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
            <Separator />
            <div className="px-4 pt-2 pb-1">
              <span className="text-xs font-medium text-muted-foreground">
                推荐应聘者 ({candidates.length})
              </span>
            </div>
          </>
        )}

        {isSearching && (
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Skeleton className="size-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Skeleton className="size-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-1.5 w-full rounded-full" />
              </div>
            </div>
          </div>
        )}

        {hasSearched && candidates.length > 0 && (
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-4 pb-4">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {hasSearched && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <IconSparkles className="size-8 stroke-1" />
            <p className="mt-2 text-xs">暂未找到匹配的应聘者</p>
            <p className="text-xs">请尝试调整招聘标题或岗位描述</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

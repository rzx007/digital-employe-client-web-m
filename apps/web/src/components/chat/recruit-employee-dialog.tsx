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
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  createEmployee,
  fetchRecruitCandidates,
  type RecruitCandidate,
} from "@/api/employee"

function getMatchScoreColor(score: number) {
  if (score >= 90) return "text-green-600"
  if (score >= 70) return "text-yellow-600"
  return "text-orange-600"
}

function getMatchScoreLabel(score: number) {
  if (score >= 90) return "高度匹配"
  if (score >= 70) return "较为匹配"
  if (score >= 50) return "部分匹配"
  return "一般匹配"
}

function CandidateCard({
  candidate,
  onHire,
}: {
  candidate: RecruitCandidate
  onHire: (candidate: RecruitCandidate) => void
}) {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <div className="rounded-md border">
      <div className="flex items-start gap-3 p-3">
        <Avatar className="size-10 shrink-0">
          <AvatarFallback className="bg-primary text-xs font-medium text-primary-foreground">
            {candidate.name.slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">
              {candidate.name}
            </span>
            <span
              className={`shrink-0 text-xs font-medium ${getMatchScoreColor(candidate.matchScore)}`}
            >
              {candidate.matchScore}% {getMatchScoreLabel(candidate.matchScore)}
            </span>
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {candidate.description}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {candidate.skills.map((skill) => (
              <Badge key={skill.id} variant="secondary" className="text-[10px]">
                {skill.skillName}
              </Badge>
            ))}
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
              查看技能详情
            </button>
          </CollapsibleTrigger>
          <Button
            variant="ghost"
            size="xs"
            className="mr-2 gap-1"
            onClick={() => onHire(candidate)}
          >
            <IconUserPlus className="size-3" />
            录用
          </Button>
        </div>
        <CollapsibleContent>
          <div className="space-y-1.5 border-t px-3 py-2">
            {candidate.skills.map((skill) => (
              <div key={skill.id} className="text-xs">
                <span className="font-medium">{skill.skillName}</span>
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

interface RecruitEmployeeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RecruitEmployeeDialog({
  open,
  onOpenChange,
}: RecruitEmployeeDialogProps) {
  const [requirement, setRequirement] = React.useState("")
  const [candidates, setCandidates] = React.useState<RecruitCandidate[]>([])
  const [isSearching, setIsSearching] = React.useState(false)
  const [hasSearched, setHasSearched] = React.useState(false)

  const handleSearch = async () => {
    if (!requirement.trim()) return
    setIsSearching(true)
    setHasSearched(false)
    setCandidates([])

    try {
      const result = await fetchRecruitCandidates({ requirement })
      setCandidates(result)
    } catch {
      toast.error("匹配失败，请稍后重试")
    } finally {
      setIsSearching(false)
      setHasSearched(true)
    }
  }

  const handleHire = async (candidate: RecruitCandidate) => {
    try {
      await createEmployee({
        name: candidate.name,
        description: candidate.description,
        skills: candidate.skills,
      })
      toast.success(`已成功录用「${candidate.name}」`)
      onOpenChange(false)
    } catch {
      toast.error("录用失败，请稍后重试")
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setRequirement("")
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
            描述您的招聘需求，系统将为您推荐最匹配的数字员工
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="space-y-2 px-4 py-3">
          <Textarea
            className="min-h-20 resize-none"
            placeholder="描述您的招聘需求，例如：需要一个能做数据分析和报表生成的员工..."
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            disabled={isSearching}
          />
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={handleSearch}
            disabled={!requirement.trim() || isSearching}
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
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 px-4 pb-4">
              {candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onHire={handleHire}
                />
              ))}
            </div>
          </ScrollArea>
        )}

        {hasSearched && candidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <IconSparkles className="size-8 stroke-1" />
            <p className="mt-2 text-xs">暂未找到匹配的应聘者</p>
            <p className="text-xs">请尝试调整需求描述</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

import * as React from "react"

import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Separator } from "@workspace/ui/components/separator"
import type { RecruitmentCandidate } from "@/api/employee"
import { cn } from "@workspace/ui/lib/utils"

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

export function CandidateCard({
  candidate,
  onSelect,
}: {
  candidate: RecruitmentCandidate
  onSelect: (candidate: RecruitmentCandidate) => void
}) {
  const [expanded, setExpanded] = React.useState(false)

  const displayCapabilities = candidate?.mcps?.slice(0, 2) ?? []
  const displaySkills = candidate.skills?.slice(0, 2) ?? []
  const remainingCapCount =
    (candidate?.mcps?.length ?? 0) - displayCapabilities.length
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
            {candidate.mcps?.map((cap, index) => (
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

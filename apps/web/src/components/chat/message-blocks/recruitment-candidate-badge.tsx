"use client"

import { memo } from "react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"
import {
  splitSkillsSummary,
  type RecruitmentCandidateItem,
} from "@/lib/chat/recruitment-tool-payload"

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  return trimmed.slice(0, 2)
}

function RecruitmentCandidateBadgeInner({
  candidate,
  className,
}: {
  candidate: RecruitmentCandidateItem
  className?: string
}) {
  const skillLabels = splitSkillsSummary(candidate.skills_summary)
  const displaySkills = skillLabels.slice(0, 4)
  const remaining = skillLabels.length - displaySkills.length
  const skillIdsText =
    candidate.skill_ids.length > 0
      ? JSON.stringify(candidate.skill_ids)
      : null

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3 transition-colors hover:border-primary/30",
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <div className="relative shrink-0">
          <Avatar className="size-9 rounded-lg">
            <AvatarFallback className="rounded-lg bg-primary/10 text-[11px] font-medium text-primary">
              {initials(candidate.name)}
            </AvatarFallback>
          </Avatar>
          {candidate.index > 0 && (
            <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-[9px] font-semibold text-muted-foreground">
              {candidate.index}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{candidate.name}</p>
          <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {candidate.description || "暂无描述"}
          </p>
          {displaySkills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {displaySkills.map((label) => (
                <Badge
                  key={label}
                  variant="outline"
                  className="text-[10px] font-normal"
                >
                  {label}
                </Badge>
              ))}
              {remaining > 0 && (
                <Badge
                  variant="outline"
                  className="text-[10px] text-muted-foreground"
                >
                  +{remaining}
                </Badge>
              )}
            </div>
          )}
          {skillIdsText && (
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground/70">
              skill_ids: {skillIdsText}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export const RecruitmentCandidateBadge = memo(RecruitmentCandidateBadgeInner)

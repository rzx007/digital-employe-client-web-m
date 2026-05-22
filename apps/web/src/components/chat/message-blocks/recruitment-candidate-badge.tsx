"use client"

import { memo, useCallback } from "react"
import { IconCircleCheck } from "@tabler/icons-react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogDescription,
  MorphingDialogTitle,
  MorphingDialogTrigger,
  useMorphingDialog,
} from "@workspace/ui/components/morphing-dialog"
import { cn } from "@workspace/ui/lib/utils"
import { useCuratorRecruitment } from "@/components/chat/curator/use-curator-recruitment"
import {
  splitSkillsSummary,
  type RecruitmentCandidateItem,
} from "@/lib/chat/recruitment-tool-payload"

const TRIGGER_CARD =
  "w-full min-w-0 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 @[22rem]/recruitment:p-3"

const MODAL_CONTENT =
  "relative w-[min(100vw-2rem,28rem)] max-h-[min(85vh,32rem)] overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"

function initials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return "?"
  return trimmed.slice(0, 2)
}

function CandidateAvatarBlock({
  candidate,
  avatarClassName,
  fallbackClassName,
}: {
  candidate: RecruitmentCandidateItem
  avatarClassName: string
  fallbackClassName?: string
}) {
  return (
    <div className="relative shrink-0">
      <Avatar className={cn("rounded-lg", avatarClassName)}>
        <AvatarFallback
          className={cn(
            "rounded-lg bg-primary/10 font-medium text-primary",
            fallbackClassName
          )}
        >
          {initials(candidate.name)}
        </AvatarFallback>
      </Avatar>
      {candidate.index > 0 && (
        <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full border bg-background text-[9px] font-semibold text-muted-foreground">
          {candidate.index}
        </span>
      )}
    </div>
  )
}

function SkillBadgeList({
  labels,
  max,
  className,
}: {
  labels: string[]
  max?: number
  className?: string
}) {
  if (labels.length === 0) return null
  const visible = max != null ? labels.slice(0, max) : labels
  const remaining = max != null ? labels.length - visible.length : 0

  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {visible.map((label) => (
        <Badge
          key={label}
          variant="outline"
          className="max-w-full truncate text-[10px] font-normal"
          title={label}
        >
          {label}
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge variant="outline" className="text-[10px] text-muted-foreground">
          +{remaining}
        </Badge>
      )}
    </div>
  )
}

function CandidatePreview({
  candidate,
  skillLabels,
}: {
  candidate: RecruitmentCandidateItem
  skillLabels: string[]
}) {
  return (
    <div className="flex w-full items-start gap-2 @[22rem]/recruitment:gap-2.5">
      <CandidateAvatarBlock
        candidate={candidate}
        avatarClassName="size-8 @[22rem]/recruitment:size-9"
        fallbackClassName="text-[11px]"
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <MorphingDialogTitle className="truncate text-sm font-medium">
          {candidate.name}
        </MorphingDialogTitle>
        <p className="mt-0.5 line-clamp-1 text-xs leading-relaxed text-muted-foreground">
          {candidate.description || "暂无描述"}
        </p>
        <SkillBadgeList
          labels={skillLabels}
          max={2}
          className="mt-1.5 @[22rem]/recruitment:mt-2"
        />
        <p className="mt-1.5 text-[10px] text-muted-foreground/80">
          点击查看详情
        </p>
      </div>
    </div>
  )
}

function CandidateHireAction({
  candidate,
}: {
  candidate: RecruitmentCandidateItem
}) {
  const recruitment = useCuratorRecruitment()
  const { setIsOpen } = useMorphingDialog()

  const handleHire = useCallback(() => {
    if (!recruitment || recruitment.hireDisabled) return
    recruitment.onHire(candidate)
    setIsOpen(false)
  }, [candidate, recruitment, setIsOpen])

  if (!recruitment) return null

  return (
    <Button
      type="button"
      className="w-full gap-1.5"
      disabled={recruitment.hireDisabled}
      onClick={handleHire}
    >
      <IconCircleCheck className="size-4" />
      录用{candidate.name}
    </Button>
  )
}

function CandidateDetail({
  candidate,
  skillLabels,
  skillIdsText,
}: {
  candidate: RecruitmentCandidateItem
  skillLabels: string[]
  skillIdsText: string | null
}) {
  return (
    <div className="space-y-4 pr-6">
      <div className="flex items-start gap-3">
        <CandidateAvatarBlock
          candidate={candidate}
          avatarClassName="size-11"
          fallbackClassName="text-sm"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <MorphingDialogTitle className="text-base font-semibold leading-tight">
            {candidate.name}
          </MorphingDialogTitle>
          {candidate.index > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              候选人 #{candidate.index}
            </p>
          )}
        </div>
      </div>

      <MorphingDialogDescription
        disableLayoutAnimation
        className="text-sm leading-relaxed text-muted-foreground"
      >
        <p className="whitespace-pre-wrap wrap-break-word">
          {candidate.description || "暂无描述"}
        </p>
      </MorphingDialogDescription>

      {skillLabels.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-foreground">技能</p>
          <SkillBadgeList labels={skillLabels} />
        </div>
      )}

      {skillIdsText && (
        <div>
          <p className="mb-1 text-xs font-medium text-foreground">skill_ids</p>
          <p className="break-all font-mono text-xs text-muted-foreground/80">
            {skillIdsText}
          </p>
        </div>
      )}

      <CandidateHireAction candidate={candidate} />
    </div>
  )
}

function RecruitmentCandidateBadgeInner({
  candidate,
  className,
}: {
  candidate: RecruitmentCandidateItem
  className?: string
}) {
  const skillLabels = splitSkillsSummary(candidate.skills_summary)
  const skillIdsText =
    candidate.skill_ids.length > 0
      ? JSON.stringify(candidate.skill_ids)
      : null

  return (
    <MorphingDialog
      transition={{ type: "spring", bounce: 0, duration: 0.28 }}
    >
      <MorphingDialogTrigger
        className={cn(TRIGGER_CARD, className)}
        aria-label={`查看候选人 ${candidate.name}`}
      >
        <CandidatePreview candidate={candidate} skillLabels={skillLabels} />
      </MorphingDialogTrigger>
      <MorphingDialogContainer>
        <MorphingDialogContent className={MODAL_CONTENT}>
          <MorphingDialogClose className="top-4 right-4 size-8" />
          <CandidateDetail
            candidate={candidate}
            skillLabels={skillLabels}
            skillIdsText={skillIdsText}
          />
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

export const RecruitmentCandidateBadge = memo(RecruitmentCandidateBadgeInner)

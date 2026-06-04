import * as React from "react"
import { IconSparkles, IconX } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { MessageResponse } from "@workspace/ui/components/ai-elements/message"
import {
  MorphingDialog,
  MorphingDialogClose,
  MorphingDialogContainer,
  MorphingDialogContent,
  MorphingDialogTitle,
  MorphingDialogTrigger,
  useMorphingDialog,
} from "@workspace/ui/components/morphing-dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import { useLocalSkillDetailQuery } from "@/hooks/use-skill-queries"
import { sourceBadgeProps } from "@/components/skills/skill-utils"

const MODAL_CONTENT =
  "relative w-[min(100vw-2rem,32rem)] max-h-[min(85vh,40rem)] overflow-y-auto rounded-xl border bg-card p-5 shadow-lg"

function sourceLabelOf(skill: SkillListItem): string {
  if (skill.source === "builtin") return "内置"
  if (skill.source === "local") return "本地"
  return skill.sourceLabel || "远程"
}

function SkillDetailContent({ skill }: { skill: SkillListItem }) {
  // 仅在弹窗打开后才拉取 SKILL.md，避免一次性请求所有技能详情。
  const { isOpen } = useMorphingDialog()
  const { data: detail, isLoading } = useLocalSkillDetailQuery(
    isOpen ? skill.skillName : null
  )
  const label = skill.displayNameZh || skill.skillName

  return (
    <div className="space-y-3 pr-6">
      <div className="flex items-start gap-2">
        <IconSparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <MorphingDialogTitle className="truncate text-base leading-tight font-semibold">
            {label}
          </MorphingDialogTitle>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {skill.skillName}
          </p>
        </div>
        <Badge {...sourceBadgeProps(skill.source)}>{sourceLabelOf(skill)}</Badge>
      </div>

      {skill.description && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {skill.description}
        </p>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-foreground">SKILL.md</p>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : detail?.skillMdContent ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <MessageResponse className="min-w-0 text-sm">
              {detail.skillMdContent}
            </MessageResponse>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">暂无 SKILL.md 内容</p>
        )}
      </div>
    </div>
  )
}

export function EmployeeSkillBadge({
  skill,
  onRemove,
}: {
  skill: SkillListItem
  onRemove: () => void
}) {
  const label = skill.displayNameZh || skill.skillName

  return (
    <MorphingDialog transition={{ type: "spring", bounce: 0, duration: 0.28 }}>
      <div className="group relative inline-flex">
        <MorphingDialogTrigger
          className={cn(
            "inline-flex items-center rounded-md border bg-background px-2 py-0.5 text-xs",
            "transition-colors hover:border-primary/40 hover:bg-accent/40",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
          aria-label={`查看技能 ${label}`}
        >
          <MorphingDialogTitle className="max-w-[12rem] truncate">
            {label}
          </MorphingDialogTitle>
        </MorphingDialogTrigger>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除技能 ${label}`}
          title="移除技能"
          className={cn(
            "absolute -top-1.5 -right-1.5 z-10 flex size-4 items-center justify-center rounded-full",
            "border bg-background text-destructive opacity-0 shadow-sm transition-opacity",
            "group-hover:opacity-100 hover:bg-destructive/15 focus-visible:opacity-100"
          )}
        >
          <IconX className="size-2.5" />
        </button>
      </div>
      <MorphingDialogContainer>
        <MorphingDialogContent className={MODAL_CONTENT}>
          <MorphingDialogClose className="top-4 right-4 size-8 rounded-md text-muted-foreground hover:bg-muted" />
          <SkillDetailContent skill={skill} />
        </MorphingDialogContent>
      </MorphingDialogContainer>
    </MorphingDialog>
  )
}

import { IconSparkles } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import type { SkillListItem } from "@/api/types"
import { sourceBadgeProps } from "./skill-utils"

export function InstalledSkillCard({
  skill,
  onClick,
}: {
  skill: SkillListItem
  onClick: () => void
}) {
  const src = skill.source ?? "local"
  return (
    <button
      type="button"
      className="flex flex-col gap-2 rounded-sm border p-4 text-left transition-colors hover:border-primary/30 hover:bg-accent/30"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm leading-snug font-medium">
          <IconSparkles className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="line-clamp-1">
            {skill.displayNameZh || skill.skillName}
          </span>
        </span>
        <Badge {...sourceBadgeProps(src)}>
          {skill.sourceLabel || (src === "builtin" ? "内置" : "本地")}
        </Badge>
      </div>
      <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {skill.description || skill.skillName}
      </span>
    </button>
  )
}

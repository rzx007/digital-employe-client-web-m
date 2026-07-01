import { IconLoader2, IconSparkles } from "@tabler/icons-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import type { SkillListItem } from "@/api/types"
import { sourceBadgeProps } from "./skill-utils"

export function RemoteSkillCard({
  skill,
  onSelect,
  onInstall,
  installing,
}: {
  skill: SkillListItem
  onSelect: () => void
  onInstall: () => void
  installing: boolean
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col gap-2 rounded-sm border p-4",
        "transition-colors hover:border-primary/30 hover:bg-accent/30"
      )}
    >
      <button
        type="button"
        className="flex min-h-0 flex-1 flex-col gap-2 text-left"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm leading-snug font-medium">
            <IconSparkles className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="line-clamp-1">
              {skill.displayNameZh || skill.skillName}
            </span>
          </span>
          <Badge {...sourceBadgeProps("remote")}>
            {skill.sourceLabel || "远程"}
          </Badge>
        </div>
        <span className="line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
          {skill.description || "暂无描述"}
        </span>
        {skill.directoryName && (
          <Badge variant="outline" className="w-fit px-1.5 py-0 text-[10px]">
            {skill.directoryName}
          </Badge>
        )}
      </button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="w-full shrink-0 text-xs"
        disabled={installing}
        onClick={(e) => {
          e.stopPropagation()
          onInstall()
        }}
      >
        {installing ? (
          <span className="flex items-center justify-center gap-1.5">
            <IconLoader2 className="size-3.5 animate-spin" />
            安装中…
          </span>
        ) : (
          "安装"
        )}
      </Button>
    </div>
  )
}

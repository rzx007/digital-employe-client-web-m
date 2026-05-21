import { Skeleton } from "@workspace/ui/components/skeleton"
import { SKILLS_GRID_CLASS, SKILLS_REMOTE_GRID_CLASS } from "./skill-grid"

function InstalledSkillCardSkeleton() {
  return (
    <div
      className="flex flex-col gap-2 rounded-sm border border-border/40 p-4"
      aria-hidden
    >
      <div className="flex items-start justify-between gap-2">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-5 w-12 shrink-0" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

function RemoteSkillCardSkeleton() {
  return (
    <div
      className="flex h-full min-h-0 flex-col gap-2 rounded-sm border border-border/40 p-4"
      aria-hidden
    >
      <div className="flex flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-5 w-12 shrink-0" />
        </div>
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="h-8 w-full shrink-0" />
    </div>
  )
}

export function SkillsCardGridSkeleton({
  variant,
  count,
}: {
  variant: "installed" | "remote"
  count: number
}) {
  const gridClass =
    variant === "remote" ? SKILLS_REMOTE_GRID_CLASS : SKILLS_GRID_CLASS
  const Card =
    variant === "remote" ? RemoteSkillCardSkeleton : InstalledSkillCardSkeleton

  return (
    <div
      className={gridClass}
      aria-busy="true"
      aria-label="技能列表加载中"
    >
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} />
      ))}
    </div>
  )
}

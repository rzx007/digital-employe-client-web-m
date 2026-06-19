import * as React from "react"
import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { cn } from "@workspace/ui/lib/utils"
import type { GroupRoomMember } from "@/api/group-room"

function initialOf(name: string | null | undefined): string {
  const t = (name ?? "").trim()
  return t ? t.slice(0, 2) : "员"
}

const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
]
function colorOf(seed: string | null | undefined): string {
  const s = (seed ?? "").trim() || "员"
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** 顶部「队员在场」条：头像叠加 + N 进行中，点击展开协作流程鸟瞰抽屉。 */
export function GroupPresenceBar({
  members,
  onOpenOverview,
  className,
}: {
  members: GroupRoomMember[]
  onOpenOverview: () => void
  className?: string
}) {
  const workers = members.filter((m) => m.role_in_room !== "leader")
  const runningCount = workers.filter((m) => m.state === "running").length
  const shown = workers.slice(0, 5)
  const overflow = workers.length - shown.length
  return (
    <button
      type="button"
      onClick={onOpenOverview}
      className={cn(
        "flex w-full items-center gap-2 border-b bg-background/60 px-4 py-2 text-left transition-colors hover:bg-muted/40",
        className
      )}
      aria-label="展开协作流程"
    >
      <div className="flex -space-x-2">
        {shown.map((m) => (
          <Avatar key={m.member_id} className="size-6 ring-2 ring-background">
            <AvatarFallback
              className={cn("text-[10px] font-semibold", colorOf(m.employee_name))}
            >
              {initialOf(m.employee_name)}
            </AvatarFallback>
          </Avatar>
        ))}
        {overflow > 0 ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {workers.length} 位队员
        {runningCount > 0 ? (
          <span className="ml-1 text-blue-600">· {runningCount} 进行中</span>
        ) : null}
      </span>
      <span className="ml-auto text-[11px] text-muted-foreground">协作流程 ›</span>
    </button>
  )
}

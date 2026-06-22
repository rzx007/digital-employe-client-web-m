import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  WorkbenchInviteMemberDialog,
  type InvitableEmployee,
} from "./workbench-invite-member-dialog"

export interface WorkbenchMember {
  id: number
  name: string
}

/**
 * 工作台成员切换器：横排成员 + 邀请入口。总管不在其中（工作台是制作车间）。
 */
export function WorkbenchChatSwitcher({
  members,
  activeId,
  onSelect,
  invitable,
  onToggleMember,
  className,
}: {
  members: WorkbenchMember[]
  activeId: number | null
  onSelect: (id: number) => void
  invitable: InvitableEmployee[]
  onToggleMember: (id: number, join: boolean) => void
  className?: string
}) {
  const [inviteOpen, setInviteOpen] = useState(false)
  return (
    <div className={cn("flex items-center gap-1 border-b p-1", className)}>
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {members.length === 0 ? (
          <span className="px-1 text-[11px] text-muted-foreground">
            还没有工作台成员，点右侧邀请
          </span>
        ) : (
          members.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={m.id === activeId ? "secondary" : "ghost"}
              className="shrink-0"
              onClick={() => onSelect(m.id)}
            >
              {m.name}
            </Button>
          ))
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => setInviteOpen(true)}
      >
        + 邀请员工
      </Button>
      <WorkbenchInviteMemberDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        employees={invitable}
        memberIds={members.map((m) => m.id)}
        onToggle={onToggleMember}
      />
    </div>
  )
}

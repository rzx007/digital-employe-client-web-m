import * as React from "react"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import type {
  GroupRoomMember,
  GroupRoomMemberState,
} from "@/api/group-room"
import { navigateToEmployeeFromGroup } from "@/lib/chat/group-navigation"
import { switchToContact } from "@/lib/chat/conversation-selection"

const STATE_META: Record<
  GroupRoomMemberState,
  { label: string; dot: string; text: string }
> = {
  ready: { label: "待命", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  running: { label: "进行中", dot: "bg-blue-500 animate-pulse", text: "text-blue-600" },
  sleeping: { label: "休眠", dot: "bg-amber-400", text: "text-amber-600" },
  done: { label: "已交付", dot: "bg-green-500", text: "text-green-600" },
}

function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  return trimmed ? trimmed.slice(0, 1) : "员"
}

function MemberRow({
  member,
  groupContactId,
  groupConversationId,
}: {
  member: GroupRoomMember
  groupContactId?: string
  groupConversationId?: string | number
}) {
  const meta = STATE_META[member.state] ?? STATE_META.ready
  const isLeader = member.role_in_room === "leader"
  const canJump =
    member.employee_id != null &&
    member.conversation_id != null &&
    groupContactId != null &&
    groupConversationId != null

  const handleClick = () => {
    if (member.employee_id == null) return
    if (canJump) {
      navigateToEmployeeFromGroup({
        groupContactId: groupContactId!,
        groupConversationId: groupConversationId!,
        employeeId: member.employee_id,
        employeeConversationId: member.conversation_id!,
      })
      return
    }
    switchToContact(`employee:${member.employee_id}`)
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/50"
    >
      <Avatar className="size-8 shrink-0">
        <AvatarFallback
          className={cn(
            "text-xs",
            isLeader ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
          )}
        >
          {initialOf(member.employee_name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {member.employee_name ?? `员工#${member.employee_id}`}
          </span>
          {isLeader ? (
            <Badge
              variant="secondary"
              className="h-4 px-1 text-[10px] font-normal"
            >
              组长
            </Badge>
          ) : null}
        </div>
        <div className={cn("flex items-center gap-1 text-xs", meta.text)}>
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </div>
      </div>
    </button>
  )
}

export function GroupMemberSidebar({
  members,
  className,
  title = "群成员",
  groupContactId,
  groupConversationId,
}: {
  members: GroupRoomMember[]
  className?: string
  title?: string
  groupContactId?: string
  groupConversationId?: string | number
}) {
  return (
    <aside
      className={cn(
        "flex w-56 shrink-0 flex-col border-l bg-background/60",
        className
      )}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold">{title}</span>
        <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
          {members.length}
        </Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-3">
          {members.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              暂无成员
            </p>
          ) : (
            members.map((m) => (
              <MemberRow
                key={m.member_id}
                member={m}
                groupContactId={groupContactId}
                groupConversationId={groupConversationId}
              />
            ))
          )}
        </div>
      </ScrollArea>
      <div className="border-t px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        @成员 派活；成员各自独立工作，结论汇总到群时间线。
      </div>
    </aside>
  )
}

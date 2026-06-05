import * as React from "react"

import { Badge } from "@workspace/ui/components/badge"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import type {
  GroupRoomMember,
  GroupRoomMemberState,
} from "@/api/group-room"
import { CURATOR_ASSISTANT_AVATAR_URL_1 } from "@/lib/avatar"
import { navigateToEmployeeFromGroup } from "@/lib/chat/group-navigation"
import { switchToContact } from "@/lib/chat/conversation-selection"
import type { AIEmployee } from "@/types/chat"

import { EmployeeContactAvatar } from "../contacts/contact-avatars"

const STATE_META: Record<
  GroupRoomMemberState,
  { label: string; dot: string; text: string }
> = {
  ready: { label: "待命", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
  queued: {
    label: "排队中",
    dot: "bg-amber-400 animate-pulse",
    text: "text-amber-600",
  },
  running: { label: "进行中", dot: "bg-blue-500 animate-pulse", text: "text-blue-600" },
  sleeping: { label: "休眠", dot: "bg-amber-400", text: "text-amber-600" },
  done: { label: "已交付", dot: "bg-green-500", text: "text-green-600" },
}

function resolveMemberAvatar(
  member: GroupRoomMember,
  participantById: Map<string, AIEmployee>
): {
  name: string
  avatar?: string
  status?: AIEmployee["status"]
} {
  if (member.role_in_room === "leader") {
    return { name: "组长", avatar: CURATOR_ASSISTANT_AVATAR_URL_1, status: "online" }
  }

  const employeeId =
    member.employee_id != null ? String(member.employee_id) : null
  const participant = employeeId ? participantById.get(employeeId) : undefined
  const name =
    member.employee_name ??
    participant?.name ??
    (employeeId ? `员工#${employeeId}` : "员工")

  return {
    name,
    avatar: participant?.avatar,
    status: participant?.status,
  }
}

function MemberRow({
  member,
  participantById,
  groupContactId,
  groupConversationId,
}: {
  member: GroupRoomMember
  participantById: Map<string, AIEmployee>
  groupContactId?: string
  groupConversationId?: string | number
}) {
  const meta = STATE_META[member.state] ?? STATE_META.ready
  const isLeader = member.role_in_room === "leader"
  const { name, avatar, status } = resolveMemberAvatar(member, participantById)
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
      <EmployeeContactAvatar
        name={name}
        avatar={avatar}
        status={status}
        showStatus={Boolean(status)}
        avatarClassName="size-8"
        statusClassName="h-2 w-2"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">
            {member.employee_name ?? name}
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
          {member.state === "running" ? (
            <span className="inline-flex items-center gap-1">
              {isLeader ? "正在拆解任务、安排人手" : "正在工作"}
              <span className="inline-flex gap-0.5">
                <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                <span className="size-1 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                <span className="size-1 animate-bounce rounded-full bg-current" />
              </span>
            </span>
          ) : (
            meta.label
          )}
        </div>
      </div>
    </button>
  )
}

export function GroupMemberSidebar({
  members,
  participants,
  className,
  title = "群成员",
  groupContactId,
  groupConversationId,
}: {
  members: GroupRoomMember[]
  participants?: AIEmployee[]
  className?: string
  title?: string
  groupContactId?: string
  groupConversationId?: string | number
}) {
  const participantById = React.useMemo(() => {
    const map = new Map<string, AIEmployee>()
    for (const participant of participants ?? []) {
      map.set(participant.id, participant)
    }
    return map
  }, [participants])

  return (
    <aside
      className={cn(
        "flex w-56 shrink-0 flex-col border-l bg-background/60",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={title}>
          {title}
        </span>
        <Badge
          variant="outline"
          className="h-5 shrink-0 px-1.5 text-[11px]"
        >
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
                participantById={participantById}
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

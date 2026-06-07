import * as React from "react"
import { toast } from "sonner"

import { Avatar, AvatarFallback } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"

import {
  fetchGroupRoomState,
  type GroupRoomMember,
  type GroupRoomMemberState,
} from "@/api/group-room"
import { CURATOR_ASSISTANT_AVATAR_URL_1 } from "@/lib/avatar"
import { navigateToEmployeeFromGroup } from "@/lib/chat/group-navigation"

import { EmployeeContactAvatar } from "../contacts/contact-avatars"
import { GroupAutoConfirmToggle } from "./group-auto-confirm-toggle"

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

/** 文字头像：取名字前两个字 */
function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim()
  return trimmed ? trimmed.slice(0, 2) : "员"
}

/** 按名字 hash 稳定取色（同一成员恒定一种配色） */
const NAME_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-teal-100 text-teal-700",
]
function colorOf(seed: string | null | undefined): string {
  const s = (seed ?? "").trim() || "员"
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return NAME_PALETTE[h % NAME_PALETTE.length]
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
  const displayName =
    member.employee_name ?? (member.employee_id != null ? `员工#${member.employee_id}` : "组长")
  const canNavigate = groupContactId != null && groupConversationId != null

  const handleClick = async () => {
    if (member.employee_id == null || !canNavigate) return
    const employeeId = member.employee_id
    let convId = member.conversation_id
    // member.conversation_id 来自房间状态，派活后短暂为 null（房间状态缓存滞后）时
    // 旧代码会 switchToContact ——那会清空已选会话、落到空白草稿页（成员在干活却
    // 看不到内容）。先抓一次最新房间状态按 employee 命中其私有会话再跳。
    if (convId == null) {
      try {
        const fresh = await fetchGroupRoomState(groupConversationId!)
        const freshMember = fresh?.members.find(
          (m) => m.employee_id === employeeId
        )
        if (freshMember?.conversation_id != null) {
          convId = freshMember.conversation_id
        }
      } catch {
        // 抓取失败则走下方兜底，不阻塞用户
      }
    }
    if (convId != null) {
      navigateToEmployeeFromGroup({
        groupContactId: groupContactId!,
        groupConversationId: groupConversationId!,
        employeeId,
        employeeConversationId: convId,
      })
      return
    }
    // 成员还没被派过活、没有私有会话：提示而非静默跳到空白页。
    toast.info(`${displayName} 还没有进行中的工作`)
  }

  return (
    <button
      type="button"
      onClick={() => {
        void handleClick()
      }}
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/50"
    >
      {isLeader ? (
        <EmployeeContactAvatar
          name="组长"
          avatar={CURATOR_ASSISTANT_AVATAR_URL_1}
          avatarClassName="size-8"
        />
      ) : (
        <Avatar className="size-8 shrink-0">
          <AvatarFallback
            className={cn("text-[11px] font-semibold", colorOf(member.employee_name))}
          >
            {initialOf(member.employee_name)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{displayName}</span>
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
  className,
  title = "群成员",
  groupContactId,
  groupConversationId,
  autoConfirm = false,
  onAutoConfirmChange,
}: {
  members: GroupRoomMember[]
  className?: string
  title?: string
  groupContactId?: string
  groupConversationId?: string | number
  autoConfirm?: boolean
  onAutoConfirmChange?: (enabled: boolean) => Promise<void> | void
}) {
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
                groupContactId={groupContactId}
                groupConversationId={groupConversationId}
              />
            ))
          )}
        </div>
      </ScrollArea>
      {onAutoConfirmChange ? (
        <div className="px-3 pt-2">
          <GroupAutoConfirmToggle
            enabled={autoConfirm}
            onChange={onAutoConfirmChange}
          />
        </div>
      ) : null}
      <div className="border-t px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">
        @成员 派活；成员各自独立工作，结论汇总到群时间线。
      </div>
    </aside>
  )
}

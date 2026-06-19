import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { cn } from "@workspace/ui/lib/utils"

import { stopGroupRoom } from "@/api/group-room"
import { getContactId } from "@/lib/chat/contact-utils"
import { computeGroupExtraMessages } from "@/lib/chat/group-extra-messages"
import { chatKeys } from "@/lib/query-keys/chat"
import { useGroupRoom } from "@/hooks/use-group-room"
import type { ChatViewContact } from "../shared/chat-view-shared"

import { ConversationChatView } from "../views/chat-conversation-view"
import { GroupMemberSidebar } from "./group-member-sidebar"
import { GroupPresenceBar } from "./group-presence-bar"
import { GroupSopPanel } from "./group-sop-panel"

/**
 * 群协作房间视图：左侧复用 1:1 的会话聊天（群时间线 + 输入框，支持 @成员），
 * 右侧成员侧栏展示谁在群里、各自状态（待命/进行中/已交付）。
 *
 * 群时间线由后端投影驱动：用户 @ 成员 → 成员私有会话干活 → 完成后结论
 * 经 room_message 事件投影回群时间线，useGroupRoom 监听后刷新消息。
 */
export function GroupRoomView({
  contact,
  title,
  conversationId,
  onOpenContacts,
  onOpenConversations,
  onNewConversation,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  contact?: ChatViewContact
  title: string
  conversationId: string | number
  onOpenContacts?: () => void
  onOpenConversations?: () => void
  onNewConversation?: () => void
}) {
  const queryClient = useQueryClient()
  const { members, dag, streaming, autoConfirm, setAutoConfirm, clearStreaming } =
    useGroupRoom(conversationId)
  const [overviewOpen, setOverviewOpen] = React.useState(false)
  const [awaitingLeaderFirstResponse, setAwaitingLeaderFirstResponse] =
    React.useState(false)

  const groupRoomBusy = React.useMemo(() => {
    const leaderRunning = members.some(
      (m) => m.role_in_room === "leader" && m.state === "running"
    )
    const workerActive = members.some(
      (m) =>
        m.role_in_room !== "leader" &&
        (m.state === "running" || m.state === "queued")
    )
    return leaderRunning || workerActive || streaming.length > 0
  }, [members, streaming])

  const handleGroupRoomStop = React.useCallback(async () => {
    const result = await stopGroupRoom(conversationId)
    clearStreaming()
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: chatKeys.messages(String(conversationId)),
      }),
      queryClient.invalidateQueries({
        queryKey: chatKeys.groupRoom(String(conversationId)),
      }),
    ])
    const stopped = result?.stopped ?? 0
    if (stopped > 0) {
      toast.success(`已停止生成（取消 ${stopped} 个执行流）`)
    } else {
      toast.success("已停止生成")
    }
  }, [clearStreaming, conversationId, queryClient])
  const hasDag = Boolean(dag?.has_dag && dag.nodes.length > 0)
  const groupContactId = contact ? getContactId(contact) ?? undefined : undefined
  const memberConversationByEmployeeId = React.useMemo(() => {
    const map = new Map<number, number>()
    for (const m of members) {
      if (m.employee_id != null && m.conversation_id != null) {
        map.set(m.employee_id, m.conversation_id)
      }
    }
    return map
  }, [members])

  // 进行中成员/组长的逐字流式 → 转成时间线临时消息，像单聊一样逐字渲染。
  // 组长在首 token 前：房间状态已 running 但尚无 stream 增量 → 占位「正在生成回复…」。
  // 用户刚发送、组长尚未起跑（awaiting）也补占位，消除空窗期以为卡死。
  // 完成后由落库的 room_message 接管，streaming 被清空。
  const extraStreamingMessages = React.useMemo(
    () =>
      computeGroupExtraMessages({
        members,
        streaming,
        awaitingLeaderFirstResponse,
      }),
    [members, streaming, awaitingLeaderFirstResponse]
  )

  // 组长首个可见输出到达 → 清占位等待态（真实流式/落库内容接管）。
  const leaderConvIdForClear = React.useMemo(() => {
    const l = members.find((m) => m.role_in_room === "leader")
    return l?.conversation_id ?? null
  }, [members])
  const leaderHasVisible = React.useMemo(() => {
    const s = streaming.find((x) =>
      leaderConvIdForClear != null
        ? x.sourceConversationId === leaderConvIdForClear
        : x.senderLabel === "组长"
    )
    return Boolean(s && s.text.trim().length > 0)
  }, [streaming, leaderConvIdForClear])
  React.useEffect(() => {
    if (leaderHasVisible) setAwaitingLeaderFirstResponse(false)
  }, [leaderHasVisible])

  // 切换会话 → reset，避免占位等待态跨会话残留（老会话进去不误现）。
  React.useEffect(() => {
    setAwaitingLeaderFirstResponse(false)
  }, [conversationId])

  return (
    <div
      className={cn("flex h-full min-h-0 w-full flex-col", className)}
      {...props}
    >
      {members.length > 0 ? (
        <GroupPresenceBar
          members={members}
          onOpenOverview={() => setOverviewOpen(true)}
        />
      ) : null}
      <ConversationChatView
        contact={contact}
        title={title}
        conversationId={conversationId}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        extraStreamingMessages={extraStreamingMessages}
        onUserSend={() => setAwaitingLeaderFirstResponse(true)}
        groupRoomBusy={groupRoomBusy}
        onGroupRoomStop={handleGroupRoomStop}
        className="min-h-0 min-w-0 flex-1"
      />
      <Sheet open={overviewOpen} onOpenChange={setOverviewOpen}>
        <SheetContent side="right" className="w-[360px] p-0 sm:max-w-[360px]">
          <SheetHeader className="px-4 py-3">
            <SheetTitle>协作流程</SheetTitle>
          </SheetHeader>
          {/* 组长统筹模式 → DAG 流程图；@直接派活 → 简单成员列表 */}
          {hasDag && dag ? (
            <GroupSopPanel
              dag={dag}
              conversationId={conversationId}
              groupContactId={groupContactId ?? `group:${conversationId}`}
              memberConversationByEmployeeId={memberConversationByEmployeeId}
              autoConfirm={autoConfirm}
              onAutoConfirmChange={setAutoConfirm}
              className="flex h-[calc(100%-3.5rem)]"
            />
          ) : (
            <GroupMemberSidebar
              members={members}
              // 用群名做标题，绝不用会话标题（=用户任务全文，会把右栏顶部塞满长文）
              title={contact?.group?.name || "群成员"}
              groupContactId={groupContactId}
              groupConversationId={conversationId}
              autoConfirm={autoConfirm}
              onAutoConfirmChange={setAutoConfirm}
              className="flex h-[calc(100%-3.5rem)]"
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

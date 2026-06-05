import * as React from "react"
import type { UIMessage } from "ai"

import { cn } from "@workspace/ui/lib/utils"

import { getContactId } from "@/lib/chat/contact-utils"
import { useGroupRoom } from "@/hooks/use-group-room"
import type { ChatViewContact } from "../shared/chat-view-shared"

import { ConversationChatView } from "../views/chat-conversation-view"
import { GroupMemberSidebar } from "./group-member-sidebar"
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
  const { members, dag, streaming } = useGroupRoom(conversationId)
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
  // 完成后由落库的 room_message 接管，streaming 被清空。
  const extraStreamingMessages = React.useMemo<UIMessage[]>(() => {
    return streaming
      .filter((s) => s.text.trim().length > 0)
      .map((s) => ({
        id: `group-stream-${s.sourceConversationId}`,
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: s.text }],
        metadata: {
          // 群时间线按发言人显示头像（组长 / 某成员）
          senderName: s.senderLabel,
          senderId: s.senderId != null ? String(s.senderId) : undefined,
          streamState: "streaming",
        },
      }))
  }, [streaming])

  return (
    <div className={cn("flex h-full min-h-0 w-full", className)} {...props}>
      <ConversationChatView
        contact={contact}
        title={title}
        conversationId={conversationId}
        onOpenContacts={onOpenContacts}
        onOpenConversations={onOpenConversations}
        onNewConversation={onNewConversation}
        extraStreamingMessages={extraStreamingMessages}
        className="min-w-0 flex-1"
      />
      {/* 组长统筹模式 → DAG 流程图；@直接派活 → 简单成员列表 */}
      {hasDag && dag ? (
        <GroupSopPanel
          dag={dag}
          conversationId={conversationId}
          groupContactId={groupContactId ?? `group:${conversationId}`}
          memberConversationByEmployeeId={memberConversationByEmployeeId}
          className="hidden w-80 shrink-0 border-l bg-background/60 md:flex"
        />
      ) : (
        <GroupMemberSidebar
          members={members}
          participants={contact?.group?.participants}
          // 用群名做标题，绝不用会话标题（=用户任务全文，会把右栏顶部塞满长文）
          title={contact?.group?.name || "群成员"}
          groupContactId={groupContactId}
          groupConversationId={conversationId}
          className="hidden md:flex"
        />
      )}
    </div>
  )
}

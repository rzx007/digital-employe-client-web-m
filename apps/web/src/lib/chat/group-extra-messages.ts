import type { UIMessage } from "ai"

export interface GroupMemberLike {
  role_in_room: string
  conversation_id: number | null
  state: string
}

export interface GroupStreamLike {
  sourceConversationId: number
  senderId: number | null
  senderLabel: string
  text: string
  charCount: number
}

/**
 * 计算群时间线追加的临时消息：进行中成员/组长的逐字流式 + 组长首响应占位。
 * 占位（pendingReply）在「后端已 running」或「用户本地已发出本轮、尚无组长可见输出」
 * （awaitingLeaderFirstResponse）时显示——后者消除「发送后纯空白、以为卡死」。
 * 一旦组长有可见流式文本（leaderHasVisibleStream），占位即不显、被真实内容取代。
 */
export function computeGroupExtraMessages({
  members,
  streaming,
  awaitingLeaderFirstResponse,
}: {
  members: GroupMemberLike[]
  streaming: GroupStreamLike[]
  awaitingLeaderFirstResponse: boolean
}): UIMessage[] {
  const leader = members.find((m) => m.role_in_room === "leader")
  const leaderConvId = leader?.conversation_id ?? null
  const leaderStream = streaming.find((s) =>
    leaderConvId != null
      ? s.sourceConversationId === leaderConvId
      : s.senderLabel === "组长"
  )
  const leaderHasVisibleStream = Boolean(
    leaderStream && leaderStream.text.trim().length > 0
  )

  const msgs: UIMessage[] = streaming
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({
      id: `group-stream-${s.sourceConversationId}`,
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: s.text }],
      metadata: {
        senderName: s.senderLabel,
        senderId: s.senderId != null ? String(s.senderId) : undefined,
        streamState: "streaming",
        streamCharCount: s.charCount,
      },
    }))

  const showPlaceholder =
    (leader?.state === "running" || awaitingLeaderFirstResponse) &&
    !leaderHasVisibleStream
  if (showPlaceholder) {
    msgs.push({
      id:
        leaderConvId != null
          ? `group-stream-${leaderConvId}`
          : "group-stream-pending-leader",
      role: "assistant",
      parts: [{ type: "text", text: "" }],
      metadata: {
        senderName: "组长",
        streamState: "streaming",
        streamCharCount: leaderStream?.charCount ?? 0,
        pendingReply: true,
      },
    })
  }

  return msgs
}

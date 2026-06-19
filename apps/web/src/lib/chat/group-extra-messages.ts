import type { UIMessage } from "ai"

import { assistantMessageHasVisibleBody } from "./group-composer-ghosts"

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

/** 组长是否已有可见的逐字流式输出（首响应已到达）。占位显示/清除两处共用，避免规则漂移。 */
export function leaderHasVisibleStream(
  members: GroupMemberLike[],
  streaming: GroupStreamLike[]
): boolean {
  const leader = members.find((m) => m.role_in_room === "leader")
  const leaderConvId = leader?.conversation_id ?? null
  const leaderStream = streaming.find((s) =>
    leaderConvId != null
      ? s.sourceConversationId === leaderConvId
      : s.senderLabel === "组长"
  )
  return Boolean(leaderStream && leaderStream.text.trim().length > 0)
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
  const leaderHasVisibleStreamFlag = leaderHasVisibleStream(members, streaming)

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
    !leaderHasVisibleStreamFlag
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

/** 一条 assistant 消息是否「空的流式占位」（streamState=streaming 且无可见正文）。 */
function isEmptyStreamingPlaceholder(message: UIMessage): boolean {
  if (message.role !== "assistant") return false
  const meta = (message as { metadata?: Record<string, unknown> }).metadata
  if (!meta || meta.streamState !== "streaming") return false
  const hasVisibleText = (message.parts ?? []).some(
    (p) =>
      p.type === "text" &&
      "text" in p &&
      typeof p.text === "string" &&
      p.text.trim().length > 0
  )
  return !hasVisibleText
}

/**
 * 把合成的流式临时消息（computeGroupExtraMessages 的产物）并入已准备好的时间线。
 *
 * 直接 `[...prepared, ...extras]` 会出现**两条**「正在生成回复...」：prepared 里可能
 * 已有一条真实的空流式占位（useChat composer 残留 / 落库的 streaming 空行，
 * stripGhostComposerAssistants 因 streamState=streaming 会保留它），extras 又合成了
 * 一条占位 → 两条空流式气泡并列。合成 extras 是当前流式态的权威表示，故合并时先剥掉
 * prepared 里的空流式占位（有可见正文的真实流式气泡保留），再追加 extras。
 */
export function mergeGroupStreamingMessages(
  prepared: UIMessage[],
  extras: UIMessage[]
): UIMessage[] {
  if (!extras.length) return prepared

  const isLeader = (m: UIMessage): boolean =>
    (m as { metadata?: Record<string, unknown> }).metadata?.senderName === "组长"
  const isPendingPlaceholder = (m: UIMessage): boolean =>
    (m as { metadata?: Record<string, unknown> }).metadata?.pendingReply === true

  // 组长已有真实可见内容（extras 里非占位组长流式有正文，或 prepared 里组长可见回复）→
  // pendingReply 占位多余，剥掉，避免与真实内容并存出现两条「正在生成回复」。
  const leaderHasRealContent =
    extras.some(
      (m) =>
        isLeader(m) &&
        !isPendingPlaceholder(m) &&
        assistantMessageHasVisibleBody(m)
    ) ||
    prepared.some(
      (m) =>
        m.role === "assistant" && isLeader(m) && assistantMessageHasVisibleBody(m)
    )

  const nextExtras = leaderHasRealContent
    ? extras.filter((m) => !isPendingPlaceholder(m))
    : extras

  const deduped = prepared.filter((m) => !isEmptyStreamingPlaceholder(m))
  return [...deduped, ...nextExtras]
}

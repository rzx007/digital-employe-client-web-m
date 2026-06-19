import { describe, it, expect } from "vitest"

import {
  computeGroupExtraMessages,
  leaderHasVisibleStream,
} from "./group-extra-messages"

type Member = { role_in_room: string; conversation_id: number | null; state: string }
type Stream = {
  sourceConversationId: number
  senderId: number | null
  senderLabel: string
  text: string
  charCount: number
}

const leader = (state: string, convId: number | null = 10): Member => ({
  role_in_room: "leader",
  conversation_id: convId,
  state,
})

describe("computeGroupExtraMessages", () => {
  it("awaiting=true 且无可见组长流 → 含一条 pendingReply 占位", () => {
    const msgs = computeGroupExtraMessages({
      members: [leader("ready")],
      streaming: [],
      awaitingLeaderFirstResponse: true,
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].metadata?.pendingReply).toBe(true)
    expect(msgs[0].metadata?.senderName).toBe("组长")
  })

  it("leader.state=running 且无可见流 → 也含占位（旧行为保留）", () => {
    const msgs = computeGroupExtraMessages({
      members: [leader("running")],
      streaming: [],
      awaitingLeaderFirstResponse: false,
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].metadata?.pendingReply).toBe(true)
  })

  it("初始态：未发送、leader ready、无流 → 无占位（老会话不误现）", () => {
    const msgs = computeGroupExtraMessages({
      members: [leader("ready")],
      streaming: [],
      awaitingLeaderFirstResponse: false,
    })
    expect(msgs).toHaveLength(0)
  })

  it("组长有可见流式文本 → 不显占位，显真实流式消息", () => {
    const stream: Stream = {
      sourceConversationId: 10,
      senderId: null,
      senderLabel: "组长",
      text: "需求清晰，我来安排",
      charCount: 8,
    }
    const msgs = computeGroupExtraMessages({
      members: [leader("running")],
      streaming: [stream],
      awaitingLeaderFirstResponse: true,
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0].metadata?.pendingReply).toBeUndefined()
    expect(msgs[0].parts[0]).toMatchObject({ type: "text", text: "需求清晰，我来安排" })
  })
})

describe("leaderHasVisibleStream", () => {
  it("组长流有文本 → true", () => {
    expect(
      leaderHasVisibleStream(
        [{ role_in_room: "leader", conversation_id: 10, state: "running" }],
        [{ sourceConversationId: 10, senderId: null, senderLabel: "组长", text: "在安排", charCount: 3 }]
      )
    ).toBe(true)
  })
  it("无组长流 → false", () => {
    expect(
      leaderHasVisibleStream(
        [{ role_in_room: "leader", conversation_id: 10, state: "running" }],
        []
      )
    ).toBe(false)
  })
  it("组长流空白文本 → false", () => {
    expect(
      leaderHasVisibleStream(
        [{ role_in_room: "leader", conversation_id: 10, state: "running" }],
        [{ sourceConversationId: 10, senderId: null, senderLabel: "组长", text: "   ", charCount: 0 }]
      )
    ).toBe(false)
  })
})

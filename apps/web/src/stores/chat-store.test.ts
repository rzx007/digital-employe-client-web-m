import { beforeEach, describe, expect, it } from "vitest"

import { useChatStore } from "./chat-store"
import type { Contact } from "@/types/chat"

// 仅需 type/curator.id 让 findCuratorContactId 解析出 "curator:5"
const curatorContact = {
  type: "curator",
  curator: { id: 5 },
} as unknown as Contact

describe("chat-store 总管会话：chat tab ↔ 工作台 同步", () => {
  beforeEach(() => {
    useChatStore.setState({
      contacts: [curatorContact],
      selectedContactId: "curator:5",
      selectedConversationId: null,
      workbenchCuratorConversationId: null,
      isDraftConversation: false,
    })
  })

  it("chat tab 选总管会话 → 同步给工作台总管面板", () => {
    useChatStore.getState().setSelectedConversationId("c2")
    expect(useChatStore.getState().workbenchCuratorConversationId).toBe("c2")
  })

  it("chat tab 当前是员工会话时 → 不动工作台总管选中", () => {
    useChatStore.setState({
      selectedContactId: "employee:9",
      workbenchCuratorConversationId: "c1",
    })
    useChatStore.getState().setSelectedConversationId("emp-conv")
    expect(useChatStore.getState().workbenchCuratorConversationId).toBe("c1")
  })

  it("工作台选总管会话 → 反向同步 chat tab（总管联系人 + 该会话）", () => {
    useChatStore.setState({ selectedContactId: null, selectedConversationId: null })
    useChatStore.getState().setWorkbenchCuratorConversationId("c3")
    const s = useChatStore.getState()
    expect(s.workbenchCuratorConversationId).toBe("c3")
    expect(s.selectedConversationId).toBe("c3")
    expect(s.selectedContactId).toBe("curator:5")
  })

  it("工作台以相同会话重复 set（自动 resolve 回写）→ 不 clobber chat tab 选中态", () => {
    useChatStore.setState({
      workbenchCuratorConversationId: "c3",
      selectedContactId: "employee:9",
      selectedConversationId: "emp-conv",
    })
    useChatStore.getState().setWorkbenchCuratorConversationId("c3")
    const s = useChatStore.getState()
    // 同值：不回写 chat tab，员工会话保持
    expect(s.selectedContactId).toBe("employee:9")
    expect(s.selectedConversationId).toBe("emp-conv")
  })

  it("selectConversation：总管镜像、员工不镜像", () => {
    useChatStore.getState().selectConversation("curator:5", "c4")
    expect(useChatStore.getState().workbenchCuratorConversationId).toBe("c4")

    useChatStore.setState({ workbenchCuratorConversationId: "keep" })
    useChatStore.getState().selectConversation("employee:9", "e2")
    expect(useChatStore.getState().workbenchCuratorConversationId).toBe("keep")
  })
})

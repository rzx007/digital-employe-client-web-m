import { beforeEach, describe, expect, it } from "vitest"

import type { Contact } from "@/types/chat"
import { useChatStore } from "@/stores/chat-store"

import {
  enterChatTab,
  selectContactForDetail,
} from "./apply"

const curatorContact: Contact = {
  type: "curator",
  curator: {
    id: "5",
    name: "总管",
    role: "总管助手",
    status: "online",
    specialty: "",
  },
}

const employeeContact: Contact = {
  type: "employee",
  employee: {
    id: "7",
    name: "员工",
    role: "执行",
    status: "online",
    specialty: "",
  },
}

function resetStore() {
  useChatStore.setState({
    contacts: [curatorContact, employeeContact],
    selectedContactId: "curator:5",
    detailContactId: null,
    selectedConversationId: 101,
    curatorNavigationReturn: null,
    activeTab: "chat",
    isDraftConversation: false,
  })
}

describe("selectContactForDetail", () => {
  beforeEach(resetStore)

  it("sets detailContactId without changing chat selection", () => {
    selectContactForDetail("employee:7")
    const state = useChatStore.getState()
    expect(state.detailContactId).toBe("employee:7")
    expect(state.selectedContactId).toBe("curator:5")
    expect(state.selectedConversationId).toBe(101)
  })
})

describe("migrateLegacyEmployeeSelection", () => {
  beforeEach(resetStore)

  it("moves persisted employee chat selection to detailContactId", () => {
    useChatStore.setState({
      selectedContactId: "employee:7",
      detailContactId: null,
    })
    useChatStore.getState().migrateLegacyEmployeeSelection()
    const state = useChatStore.getState()
    expect(state.selectedContactId).toBe("curator:5")
    expect(state.detailContactId).toBe("employee:7")
  })
})

describe("setActiveTab chat safety net", () => {
  beforeEach(resetStore)

  it("resets employee selectedContactId to curator when entering chat tab", () => {
    useChatStore.setState({
      selectedContactId: "employee:7",
      activeTab: "contacts",
    })
    useChatStore.getState().setActiveTab("chat")
    expect(useChatStore.getState().selectedContactId).toBe("curator:5")
  })

  it("restores curator conversation id after employee deep link (not stale exec id)", () => {
    useChatStore.setState({
      selectedContactId: "curator:5",
      selectedConversationId: 9999,
      workbenchCuratorConversationId: 101,
      curatorNavigationReturn: {
        curatorContactId: "curator:5",
        curatorConversationId: 101,
        employeeId: "employee:7",
        employeeConversationId: 9999,
        returnTab: "workbench",
      },
      activeTab: "workbench",
    })
    useChatStore.getState().setActiveTab("chat")
    const state = useChatStore.getState()
    expect(state.selectedContactId).toBe("curator:5")
    expect(state.selectedConversationId).toBe(101)
    expect(state.curatorNavigationReturn).toBeNull()
  })

  it("does not reset to curator while active employee deep link (查看)", () => {
    useChatStore.setState({
      selectedContactId: "employee:7",
      selectedConversationId: 9999,
      curatorNavigationReturn: {
        curatorContactId: "curator:5",
        curatorConversationId: 101,
        employeeId: "employee:7",
        employeeConversationId: 9999,
        returnTab: "chat",
      },
      activeTab: "workbench",
    })
    useChatStore.getState().setActiveTab("chat")
    const state = useChatStore.getState()
    expect(state.selectedContactId).toBe("employee:7")
    expect(state.selectedConversationId).toBe(9999)
    expect(state.curatorNavigationReturn).not.toBeNull()
  })
})

describe("switchToContact", () => {
  beforeEach(resetStore)

  it("routes employee to contacts detail instead of chat", () => {
    useChatStore.getState().switchToContact("employee:7")
    const state = useChatStore.getState()
    expect(state.activeTab).toBe("contacts")
    expect(state.detailContactId).toBe("employee:7")
    expect(state.selectedContactId).toBe("curator:5")
  })

  it("opens curator chat for curator contact", () => {
    useChatStore.getState().switchToContact("curator:5")
    const state = useChatStore.getState()
    expect(state.activeTab).toBe("chat")
    expect(state.selectedContactId).toBe("curator:5")
  })
})

describe("enterChatTab", () => {
  beforeEach(resetStore)

  it("enters chat tab and applies curator safety net", () => {
    useChatStore.setState({
      selectedContactId: "employee:7",
      activeTab: "contacts",
    })
    enterChatTab()
    expect(useChatStore.getState().activeTab).toBe("chat")
    expect(useChatStore.getState().selectedContactId).toBe("curator:5")
  })
})

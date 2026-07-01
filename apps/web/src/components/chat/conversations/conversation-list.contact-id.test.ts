import { describe, expect, it } from "vitest"

import type { Contact } from "@/types/chat"

import { resolveListContactId } from "./conversation-list"

const curator: Contact = {
  type: "curator",
  curator: {
    id: "5",
    name: "总管",
    role: "总管助手",
    status: "online",
    specialty: "",
  },
}

const employee: Contact = {
  type: "employee",
  employee: {
    id: "7",
    name: "员工",
    role: "执行",
    status: "online",
    specialty: "",
  },
}

describe("resolveListContactId", () => {
  it("固定总管联系人用带前缀 contactId（curator:5），与 create/delete 写缓存 key 一致", () => {
    // 回归：曾用裸 id '5' → 与写缓存的 'curator:5' desync，新建对话不进列表、删除不跳转
    expect(resolveListContactId(curator, "curator:99")).toBe("curator:5")
  })

  it("固定员工联系人用带前缀 contactId（employee:7）", () => {
    expect(resolveListContactId(employee, null)).toBe("employee:7")
  })

  it("无 override 跟随全局 selectedContactId", () => {
    expect(resolveListContactId(undefined, "curator:5")).toBe("curator:5")
    expect(resolveListContactId(undefined, null)).toBeNull()
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

// mock 掉真实建会话 API，断言去重 + 透传
const mockCreate = vi.fn()
vi.mock("@/api/chat", () => ({
  createConversation: (...args: unknown[]) => mockCreate(...args),
}))

import { ensureEmployeeConversation } from "./ensure-employee-conversation"
import type { Contact } from "@/types/chat"

function empContact(id: string): Contact {
  return {
    type: "employee",
    employee: {
      id,
      name: "工作台助手",
    } as Contact["employee"],
  }
}

beforeEach(() => {
  mockCreate.mockReset()
})

describe("ensureEmployeeConversation", () => {
  it("建会话并返回结果", async () => {
    mockCreate.mockResolvedValue({ id: 123, contactId: "employee:69" })
    const conv = await ensureEmployeeConversation(empContact("69"))
    expect(conv.id).toBe(123)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("同一员工并发调用合并为一次创建（去重）", async () => {
    let resolveFn: (v: unknown) => void = () => {}
    mockCreate.mockImplementation(
      () => new Promise((r) => (resolveFn = r))
    )
    const c = empContact("69")
    const p1 = ensureEmployeeConversation(c)
    const p2 = ensureEmployeeConversation(c)
    resolveFn({ id: 7, contactId: "employee:69" })
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.id).toBe(7)
    expect(r2.id).toBe(7)
    // 并发只建一次
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("非员工联系人抛错", async () => {
    await expect(
      ensureEmployeeConversation({ type: "curator" } as Contact)
    ).rejects.toThrow()
  })
})

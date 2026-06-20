import { describe, expect, it } from "vitest"
import type { UIMessage } from "ai"

import { dedupeHitlPartsInMessage } from "./parts-dedupe"

describe("dedupeHitlPartsInMessage", () => {
  it("removes stale pending when same toolCallId has output-available", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "output-available",
          output: { text: "done" },
        },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[1]" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const tools = next.parts.filter((p) => p.type.startsWith("tool-"))
    expect(tools).toHaveLength(1)
    expect((tools[0] as { state?: string }).state).toBe("output-available")
  })

  it("keeps only the last pending part for duplicate toolCallId", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "批量解聘" },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[]" },
        },
        {
          type: "tool-delete_employees_batch",
          toolCallId: "call_a",
          state: "input-available",
          input: { employee_ids: "[25, 26]" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const tools = next.parts.filter((p) =>
      p.type.startsWith("tool-delete_employees_batch")
    )
    expect(tools).toHaveLength(1)
    expect(
      (tools[0] as { input?: { employee_ids?: string } }).input?.employee_ids
    ).toBe("[25, 26]")
  })

  it("keeps single output-available external_dir part and drops stale pending (merged bubble)", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "等待用户确认..." },
        {
          type: "tool-request_external_dir_access",
          toolCallId: "call_ext",
          state: "input-available",
          input: { path: "/tmp/outside" },
        },
        {
          type: "tool-request_external_dir_access",
          toolCallId: "call_ext",
          state: "output-available",
          output: { text: "已授权" },
          input: { path: "/tmp/outside" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const tools = next.parts.filter((p) =>
      p.type.startsWith("tool-request_external_dir_access")
    )
    expect(tools).toHaveLength(1)
    expect((tools[0] as { state?: string }).state).toBe("output-available")
  })

  it("drops orphan 等待用户确认 placeholder when HITL resolved in merged bubble", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "等待用户确认..." },
        {
          type: "tool-request_external_dir_access",
          toolCallId: "call_ext",
          state: "output-available",
          output: { text: "已授权" },
          input: { path: "/tmp/outside" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const texts = next.parts.filter((p) => p.type === "text")
    expect(texts).toHaveLength(0)
  })

  it("keeps 等待用户确认 placeholder when HITL is still pending (no resolved output)", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "等待用户确认..." },
        {
          type: "tool-request_external_dir_access",
          toolCallId: "call_ext",
          state: "input-available",
          input: { path: "/tmp/outside" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const texts = next.parts.filter((p) => p.type === "text")
    expect(texts).toHaveLength(1)
    expect((texts[0] as { text?: string }).text).toBe("等待用户确认...")
  })

  it("does not delete normal text even when HITL resolved", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "我已经帮你写入了目标目录。" },
        {
          type: "tool-request_external_dir_access",
          toolCallId: "call_ext",
          state: "output-available",
          output: { text: "已授权" },
          input: { path: "/tmp/outside" },
        },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const texts = next.parts.filter((p) => p.type === "text")
    expect(texts).toHaveLength(1)
    expect((texts[0] as { text?: string }).text).toBe(
      "我已经帮你写入了目标目录。"
    )
  })

  it("keeps only the last duplicate text part", () => {
    const message = {
      id: "1",
      role: "assistant",
      parts: [
        { type: "text", text: "没关系，重新发起解聘流程" },
        { type: "text", text: "没关系，重新发起解聘流程" },
      ],
    } as UIMessage

    const next = dedupeHitlPartsInMessage(message)
    const texts = next.parts.filter((p) => p.type === "text")
    expect(texts).toHaveLength(1)
    expect((texts[0] as { text?: string }).text).toBe(
      "没关系，重新发起解聘流程"
    )
  })
})

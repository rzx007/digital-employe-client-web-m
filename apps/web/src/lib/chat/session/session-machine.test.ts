import { describe, expect, it } from "vitest"
import { initialSessionMachine, sessionReducer } from "./session-machine"
import type { ActiveHitl } from "@/lib/chat/hitl"

const hitl = { dbMessageId: "9", toolCallId: "c1", kind: "clarify" } as ActiveHitl

describe("sessionReducer", () => {
  it("conversation switch resets bookkeeping and clears hitl", () => {
    let s = sessionReducer(initialSessionMachine, { type: "HYDRATED", convKey: "1", sig: "2:5" })
    s = sessionReducer(s, { type: "INTERRUPTED", hitl })
    s = sessionReducer(s, { type: "CONVERSATION_SWITCHED" })
    expect(s).toEqual(initialSessionMachine)
  })

  it("HITL approved clears activeHitl + activates, but does NOT clear resume attempts (only RESUME_RESET does)", () => {
    let s = sessionReducer(
      { ...initialSessionMachine, resumeAttempts: { "7": 1 } },
      { type: "INTERRUPTED", hitl }
    )
    s = sessionReducer(s, { type: "HITL_APPROVED" })
    expect(s.activeHitl).toBeNull()
    expect(s.active).toBe(true)
    expect(s.resumeAttempts).toEqual({ "7": 1 })
    s = sessionReducer(s, { type: "RESUME_RESET" })
    expect(s.resumeAttempts).toEqual({})
  })

  it("terminal cancelled deactivates and forgets hydration", () => {
    const s = sessionReducer({ ...initialSessionMachine, active: true, hydratedConvId: "1" }, { type: "TERMINAL", status: "cancelled" })
    expect(s.active).toBe(false)
    expect(s.hydratedConvId).toBeNull()
  })

  it("non-cancelled terminal keeps active/hydration", () => {
    const start = { ...initialSessionMachine, active: true, hydratedConvId: "1" }
    expect(sessionReducer(start, { type: "TERMINAL", status: "completed" })).toEqual(start)
  })

  it("resume attempt increments per assistant id; outbound prepare clears attempts but keeps hydration", () => {
    let s = sessionReducer(
      { ...initialSessionMachine, hydratedConvId: "1", lastHydratedSig: "3:42" },
      { type: "RESUME_ATTEMPTED", assistantId: "42" }
    )
    expect(s.resumeAttempts).toEqual({ "42": 1 })
    s = sessionReducer(s, { type: "RESUME_ATTEMPTED", assistantId: "42" })
    expect(s.resumeAttempts).toEqual({ "42": 2 })
    s = sessionReducer(s, { type: "OUTBOUND_PREPARED" })
    expect(s.resumeAttempts).toEqual({})
    expect(s.active).toBe(true)
    expect(s.activeHitl).toBeNull()
    expect(s.hydratedConvId).toBe("1")
    expect(s.lastHydratedSig).toBe("3:42")
  })

  it("ACTIVATED returns the same object reference when already active", () => {
    const s = { ...initialSessionMachine, active: true }
    expect(sessionReducer(s, { type: "ACTIVATED" })).toBe(s)
  })

  it("INTERRUPTED with null hitl is a no-op (same state reference)", () => {
    expect(
      sessionReducer(initialSessionMachine, { type: "INTERRUPTED", hitl: null })
    ).toBe(initialSessionMachine)
  })
})

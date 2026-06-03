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

  it("HITL approved clears activeHitl + activates, but does NOT clear resume dedupe (only RESUME_RESET does)", () => {
    let s = sessionReducer({ ...initialSessionMachine, resumeAttemptedFor: "7" }, { type: "INTERRUPTED", hitl })
    s = sessionReducer(s, { type: "HITL_APPROVED" })
    expect(s.activeHitl).toBeNull()
    expect(s.active).toBe(true)
    expect(s.resumeAttemptedFor).toBe("7")
    s = sessionReducer(s, { type: "RESUME_RESET" })
    expect(s.resumeAttemptedFor).toBeNull()
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

  it("resume attempt records assistant id; outbound prepare clears it but keeps hydration", () => {
    let s = sessionReducer(
      { ...initialSessionMachine, hydratedConvId: "1", lastHydratedSig: "3:42" },
      { type: "RESUME_ATTEMPTED", assistantId: "42" }
    )
    expect(s.resumeAttemptedFor).toBe("42")
    s = sessionReducer(s, { type: "OUTBOUND_PREPARED" })
    expect(s.resumeAttemptedFor).toBeNull()
    expect(s.active).toBe(true)
    expect(s.activeHitl).toBeNull()
    expect(s.hydratedConvId).toBe("1")
    expect(s.lastHydratedSig).toBe("3:42")
  })
})

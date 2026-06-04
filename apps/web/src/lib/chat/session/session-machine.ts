import type { ActiveHitl } from "@/lib/chat/hitl"

export type SessionMachine = {
  active: boolean
  activeHitl: ActiveHitl | null
  hydratedConvId: string | null
  lastHydratedSig: string
  resumeAttempts: Record<string, number>
}

export const initialSessionMachine: SessionMachine = {
  active: false,
  activeHitl: null,
  hydratedConvId: null,
  lastHydratedSig: "",
  resumeAttempts: {},
}

export type SessionEvent =
  | { type: "CONVERSATION_SWITCHED" }
  | { type: "OUTBOUND_PREPARED" }
  | { type: "HYDRATED"; convKey: string; sig: string }
  | { type: "INTERRUPTED"; hitl: ActiveHitl | null }
  | { type: "TERMINAL"; status: string }
  | { type: "STREAM_STOPPED" }
  | { type: "HITL_APPROVED" }
  | { type: "RESUME_RESET"; assistantId?: string }
  | { type: "RESUME_ATTEMPTED"; assistantId: string }
  | { type: "ACTIVATED" }
  | { type: "SEED_HITL"; hitl: ActiveHitl | null }

export function sessionReducer(
  state: SessionMachine,
  event: SessionEvent
): SessionMachine {
  switch (event.type) {
    case "CONVERSATION_SWITCHED":
      return initialSessionMachine
    case "OUTBOUND_PREPARED":
      return { ...state, active: true, activeHitl: null, resumeAttempts: {} }
    case "ACTIVATED":
      return state.active ? state : { ...state, active: true }
    case "HYDRATED":
      return { ...state, hydratedConvId: event.convKey, lastHydratedSig: event.sig }
    case "SEED_HITL":
      return { ...state, activeHitl: event.hitl }
    case "INTERRUPTED":
      return event.hitl ? { ...state, activeHitl: event.hitl } : state
    case "RESUME_ATTEMPTED":
      return {
        ...state,
        resumeAttempts: {
          ...state.resumeAttempts,
          [event.assistantId]:
            (state.resumeAttempts[event.assistantId] ?? 0) + 1,
        },
      }
    case "HITL_APPROVED":
      return { ...state, active: true, activeHitl: null }
    case "RESUME_RESET":
      if (event.assistantId) {
        const { [event.assistantId]: _removed, ...rest } = state.resumeAttempts
        return { ...state, resumeAttempts: rest }
      }
      return { ...state, resumeAttempts: {} }
    case "STREAM_STOPPED":
      return { ...state, active: false, hydratedConvId: null }
    case "TERMINAL":
      return event.status === "cancelled"
        ? { ...state, active: false, hydratedConvId: null }
        : state
    default:
      return state
  }
}

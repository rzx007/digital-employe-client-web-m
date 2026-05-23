export type HitlPayload = {
  action_requests: Array<{ name: string; args: Record<string, unknown> }>
  review_configs: unknown[]
}

export type StreamTerminalStatus =
  | "completed"
  | "cancelled"
  | "error"
  | "interrupted"
  | "no_stream"

export type ConversationRuntimeListener = {
  onInterrupted?: (
    payload: HitlPayload & { message_id?: string | number | null }
  ) => void
  onTerminal?: (info: {
    status: StreamTerminalStatus
    message_id?: string | number | null
    interrupt_payload?: HitlPayload
  }) => void
}

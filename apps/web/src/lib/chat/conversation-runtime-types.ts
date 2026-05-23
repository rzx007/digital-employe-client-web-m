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
  onStreamId?: (streamId: string) => void
  onInterrupted?: (payload: HitlPayload & { stream_id?: string | null }) => void
  onTerminal?: (info: {
    status: StreamTerminalStatus
    stream_id?: string | null
    interrupt_payload?: HitlPayload
  }) => void
}

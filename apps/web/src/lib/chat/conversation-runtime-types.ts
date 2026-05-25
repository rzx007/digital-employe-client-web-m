export type StreamTerminalStatus =
  | "completed"
  | "cancelled"
  | "error"
  | "interrupted"
  | "no_stream"

export type ConversationRuntimeListener = {
  onInterrupted?: (payload: {
    message_id?: string | number | null
    message_parts?: unknown[]
  }) => void
  onTerminal?: (info: {
    status: StreamTerminalStatus
    message_id?: string | number | null
  }) => void
}

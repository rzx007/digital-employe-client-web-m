export interface PendingResource {
  toolCallId: string
  path: string
  content: string
  isStreaming: boolean
  updatedAt: number
}

export interface UpsertPendingResourceInput {
  toolCallId: string
  path: string
  content: string
  isStreaming: boolean
}

export type ClearPendingResourceRef =
  | { toolCallId: string; path?: never }
  | { path: string; toolCallId?: never }

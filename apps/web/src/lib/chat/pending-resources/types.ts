export interface PendingResource {
  path: string
  content: string
  isStreaming: boolean
  updatedAt: number
}

export interface UpsertPendingResourceInput {
  path: string
  content: string
  isStreaming: boolean
}

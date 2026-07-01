import type {
  ConversationRuntimeListener,
  StreamTerminalStatus,
} from "./conversation-runtime-types"

class ConversationRuntimeBus {
  private listeners = new Map<string, Set<ConversationRuntimeListener>>()

  subscribe(
    conversationId: string,
    listener: ConversationRuntimeListener
  ): () => void {
    const key = String(conversationId)
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      const current = this.listeners.get(key)
      if (!current) return
      current.delete(listener)
      if (current.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  private emit(
    conversationId: string,
    fn: (l: ConversationRuntimeListener) => void
  ) {
    const set = this.listeners.get(String(conversationId))
    if (!set) return
    for (const listener of set) {
      fn(listener)
    }
  }

  emitInterrupted(
    conversationId: string,
    payload: {
      message_id?: string | number | null
      message_parts?: unknown[]
    }
  ) {
    this.emit(conversationId, (l) => l.onInterrupted?.(payload))
  }

  emitTerminal(
    conversationId: string,
    info: {
      status: StreamTerminalStatus
      message_id?: string | number | null
    }
  ) {
    this.emit(conversationId, (l) => l.onTerminal?.(info))
  }
}

export const conversationRuntimeBus = new ConversationRuntimeBus()

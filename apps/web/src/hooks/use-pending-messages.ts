import { useState, useEffect, useCallback, useRef } from "react"

export interface PendingMessage {
  id: string
  text: string
  command?: { id: string; title: string } | null
  mentions?: Array<{ id: string; name: string }>
}

interface UsePendingMessagesOptions {
  status: "submitted" | "streaming" | "ready" | "error"
  onSend: (text: string) => Promise<void>
  onStop?: () => void
  /**
   * 后端仍在跑（DB 末条 assistant streamState=streaming）但本地 SSE 已「假结束」
   * （status=ready）时为 true。此时不能 flush 队列——否则会在后台流仍活跃时发送，
   * 触发后端抢占/「流超时」。仅当后端真正终态后才放行排队消息。
   */
  backendBusy?: boolean
}

interface UsePendingMessagesReturn {
  queue: PendingMessage[]
  enqueue: (message: PendingMessage) => void
  remove: (id: string) => void
  sendNow: (id: string) => Promise<void>
  moveUp: (id: string) => void
  moveDown: (id: string) => void
}

export function usePendingMessages({
  status,
  onSend,
  onStop,
  backendBusy = false,
}: UsePendingMessagesOptions): UsePendingMessagesReturn {
  const [queue, setQueue] = useState<PendingMessage[]>([])
  const isSendingRef = useRef(false)

  const enqueue = useCallback((message: PendingMessage) => {
    setQueue((prev) => [...prev, message])
  }, [])

  const remove = useCallback((id: string) => {
    setQueue((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const moveUp = useCallback((id: string) => {
    setQueue((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx <= 0) return prev
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }, [])

  const moveDown = useCallback((id: string) => {
    setQueue((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }, [])

  const sendNow = useCallback(
    async (id: string) => {
      let item: PendingMessage | undefined
      setQueue((prev) => {
        item = prev.find((m) => m.id === id)
        return item ? prev.filter((m) => m.id !== id) : prev
      })
      if (!item) return
      if (onStop) onStop()
      isSendingRef.current = true
      try {
        await onSend(item.text)
      } finally {
        isSendingRef.current = false
      }
    },
    [onSend, onStop]
  )

  useEffect(() => {
    if (
      (status === "ready" || status === "error") &&
      !backendBusy &&
      queue.length > 0 &&
      !isSendingRef.current
    ) {
      const first = queue[0]
      setQueue((prev) => prev.slice(1))
      isSendingRef.current = true
      onSend(first.text).finally(() => {
        isSendingRef.current = false
      })
    }
  }, [status, backendBusy, queue, onSend])

  return { queue, enqueue, remove, sendNow, moveUp, moveDown }
}

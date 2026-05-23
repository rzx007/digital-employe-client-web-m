import { useEffect, useRef, useState } from "react"
import { useAuthStore } from "@/stores/auth-store"

export type WorkspaceEvent =
  | {
      type: "task_started"
      task_id: number
      conversation_id: number
      employee_id: number
      employee_name: string
      task_name: string
    }
  | { type: "task_completed"; task_id: number; conversation_id: number }
  | {
      type: "task_failed"
      task_id: number
      conversation_id: number
      error?: string
    }
  | {
      type: "orchestration_plan_generated"
      plan_id: number
      summary?: string
      total_tasks?: number
      tasks?: Array<{
        task_id: number
        task_name: string
        employee_name: string
        cron?: string | null
        execute_mode: string
      }>
    }
  | {
      type: "orchestration_plan_generated"
      plan_id: number
      status?: string
      total_tasks?: number
    }
  | {
      type: "conversation_status_changed"
      conversation_id: number
      target_type: string
      target_id: number
      status: string
    }

type EventHandler = (event: WorkspaceEvent) => void

const MAX_RECONNECT_COUNT = 10
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

let _eventSource: EventSource | null = null
const _handlers: Set<EventHandler> = new Set()
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectCount = 0
let _isConnected = false
const _connectionListeners: Set<(connected: boolean) => void> = new Set()

function notifyConnectionChange(connected: boolean) {
  _isConnected = connected
  _connectionListeners.forEach((fn) => fn(connected))
}

function getBackoffMs(): number {
  const delay = Math.min(
    RECONNECT_BASE_MS * Math.pow(2, _reconnectCount),
    RECONNECT_MAX_MS
  )
  return delay + Math.random() * 1000
}

function connect(workspaceId: number) {
  disconnect()

  const baseUrl =
    (typeof window !== "undefined" &&
      (window as unknown as { __BASE_URL__: string }).__BASE_URL__) ||
    (import.meta.env.VITE_BACKEND_URL
      ? `${import.meta.env.VITE_BACKEND_URL}:${import.meta.env.VITE_BACKEND_PORT}`
      : "/actus")

  const url = `${baseUrl}/workspaces/${workspaceId}/events`

  const es = new EventSource(url)
  _eventSource = es

  es.onopen = () => {
    _reconnectCount = 0
    notifyConnectionChange(true)
  }

  es.onmessage = (e) => {
    try {
      const event: WorkspaceEvent = JSON.parse(e.data)
      _handlers.forEach((handler) => handler(event))
    } catch {
      // ignore parse errors
    }
  }

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      notifyConnectionChange(false)
      _eventSource = null

      if (_reconnectCount < MAX_RECONNECT_COUNT) {
        const delay = getBackoffMs()
        _reconnectCount++
        console.error(
          `[ws-events] disconnected, reconnecting in ${Math.round(delay)}ms (attempt ${_reconnectCount}/${MAX_RECONNECT_COUNT})`
        )
        _reconnectTimer = setTimeout(() => connect(workspaceId), delay)
      } else {
        console.error("[ws-events] max reconnect attempts reached, giving up")
      }
    }
  }
}

function disconnect() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer)
    _reconnectTimer = null
  }
  if (_eventSource) {
    _eventSource.close()
    _eventSource = null
  }
  notifyConnectionChange(false)
  _reconnectCount = 0
}

export function useWorkspaceEvents(handler?: EventHandler) {
  const [isConnected, setIsConnected] = useState(_isConnected)
  const handlerRef = useRef<EventHandler | undefined>(undefined)
  const workspaceId = useAuthStore((s) => s.workspaceId)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (workspaceId == null) return

    const connectionListener = (connected: boolean) => setIsConnected(connected)
    _connectionListeners.add(connectionListener)

    const wrapped: EventHandler = (event) => {
      handlerRef.current?.(event)
    }
    _handlers.add(wrapped)

    connect(workspaceId)

    return () => {
      _connectionListeners.delete(connectionListener)
      _handlers.delete(wrapped)
      if (_handlers.size === 0) {
        disconnect()
      }
    }
  }, [workspaceId])

  return { isConnected }
}

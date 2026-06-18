import { useEffect, useRef, useState } from "react"
import { useAuthStore } from "@/stores/auth-store"
import { getActiveWorkspaceId } from "@/lib/workspace-id"
import { getServerBaseUrl } from "@/lib/request"

export type WorkspaceEvent =
  | {
      type: "task_started"
      task_id: number
      conversation_id: number
      employee_id: number
      employee_name: string
      task_name: string
    }
  | {
      type: "task_completed"
      task_id: number | null
      conversation_id: number
      execution_log_id?: number
      orchestrator_conversation_id?: number | null
      summary_message_id?: number | null
    }
  | {
      type: "task_failed"
      task_id: number | null
      conversation_id: number
      error?: string
      execution_log_id?: number
      orchestrator_conversation_id?: number | null
      summary_message_id?: number | null
    }
  | {
      // 服务端发起的总管增量汇报 turn 已起流：前端据此 refetch 总管会话消息,
      // 看到 streaming 占位后 resume/attach 到该流,实时显示(否则只在查看历史时出现)。
      type: "orchestrator_turn_started"
      orchestrator_conversation_id: number
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
  | {
      type: "room_message"
      room_id: number
      room_conversation_id: number
      message_id: number
      role: "user" | "assistant"
      content: string
      /** 产出该消息的源会话（组长/成员私有会话）id，用于精确清理对应逐字流式临时态 */
      source_conversation_id?: number | null
    }
  | {
      type: "room_member_state"
      room_id: number
      member_id: number
      employee_id: number
      state: "ready" | "running" | "sleeping" | "done"
    }
  | {
      type: "room_message_stream"
      room_id: number
      room_conversation_id: number
      source_conversation_id: number
      delta: string
      first: boolean
      /** 累计已生成字符数（用于显示“正在生成 N 字”进度） */
      acc?: number
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
/** 是否曾经断开过——用于区分「首次连接」与「断后重连」。 */
let _everDisconnected = false
const _connectionListeners: Set<(connected: boolean) => void> = new Set()
/**
 * 重连成功（断后再 onopen）时触发的监听器。
 *
 * 这条全局 SSE 没有 buffer/重放/Last-Event-ID，断流窗口内的
 * room_message_stream / room_message 等事件会永久丢失。重连后必须由订阅方
 * 从 DB 补拉，否则会出现「组长 ack 之后不输出、必须再发条消息才显示」的卡死表象。
 */
const _reconnectListeners: Set<() => void> = new Set()

function notifyConnectionChange(connected: boolean) {
  _isConnected = connected
  _connectionListeners.forEach((fn) => fn(connected))
}

function notifyReconnect() {
  _reconnectListeners.forEach((fn) => fn())
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
    getServerBaseUrl()

  const url = `${baseUrl}/workspaces/${workspaceId}/events`

  const es = new EventSource(url)
  _eventSource = es

  es.onopen = () => {
    _reconnectCount = 0
    notifyConnectionChange(true)
    // 断后重连成功：通知订阅方从 DB 补拉断流窗口内丢失的事件。
    // 首次连接（从未断过）不触发，避免无谓的额外拉取。
    if (_everDisconnected) {
      _everDisconnected = false
      notifyReconnect()
    }
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
      _everDisconnected = true
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

export function useWorkspaceEvents(
  handler?: EventHandler,
  /**
   * 断后重连成功时回调——订阅方应在此从 DB 补拉断流窗口内丢失的事件
   * （这条 SSE 无重放，否则会出现「组长不输出」的卡死表象）。
   */
  onReconnect?: () => void
) {
  const [isConnected, setIsConnected] = useState(_isConnected)
  const handlerRef = useRef<EventHandler | undefined>(undefined)
  const reconnectRef = useRef<(() => void) | undefined>(undefined)
  const authWorkspaceId = useAuthStore((s) => s.workspaceId)
  const workspaceId = authWorkspaceId ?? getActiveWorkspaceId()

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    reconnectRef.current = onReconnect
  }, [onReconnect])

  useEffect(() => {
    if (workspaceId == null || Number.isNaN(workspaceId)) return

    const connectionListener = (connected: boolean) => setIsConnected(connected)
    _connectionListeners.add(connectionListener)

    const wrapped: EventHandler = (event) => {
      handlerRef.current?.(event)
    }
    _handlers.add(wrapped)

    const reconnectListener = () => {
      reconnectRef.current?.()
    }
    _reconnectListeners.add(reconnectListener)

    connect(workspaceId)

    return () => {
      _connectionListeners.delete(connectionListener)
      _handlers.delete(wrapped)
      _reconnectListeners.delete(reconnectListener)
      if (_handlers.size === 0) {
        disconnect()
      }
    }
  }, [workspaceId])

  return { isConnected }
}

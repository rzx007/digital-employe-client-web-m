import { useEffect, useRef, useState } from "react"
import { useOrchestrationStore } from "@/stores/orchestration-store"
import { useExecutionReportsStore } from "@/stores/execution-reports-store"

export type WorkspaceEvent =
  | { type: "task_started"; task_id: number; conversation_id: number; employee_id: number; employee_name: string; task_name: string }
  | { type: "task_completed"; task_id: number; conversation_id: number }
  | { type: "task_failed"; task_id: number; conversation_id: number; error?: string }
  | { type: "orchestration_plan_generated"; plan_id: number; summary?: string; total_tasks?: number; tasks?: Array<{ task_id: number; task_name: string; employee_name: string; cron?: string | null; execute_mode: string }> }
  | { type: "orchestration_plan_generated"; plan_id: number; status?: string; total_tasks?: number }

type EventHandler = (event: WorkspaceEvent) => void

const MAX_RECONNECT_COUNT = 10
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

let _eventSource: EventSource | null = null
let _handlers: Set<EventHandler> = new Set()
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null
let _reconnectCount = 0
let _isConnected = false
let _connectionListeners: Set<(connected: boolean) => void> = new Set()

const _taskCache = new Map<number, { employee_id: number; employee_name: string; task_name: string }>()

function notifyConnectionChange(connected: boolean) {
  _isConnected = connected
  _connectionListeners.forEach((fn) => fn(connected))
}

function bridgeEventToStore(event: WorkspaceEvent) {
  try {
    const store = useOrchestrationStore.getState()
    switch (event.type) {
      case "orchestration_plan_generated": {
        if ("tasks" in event && event.tasks) {
          store.setPendingPlan({
            planId: event.plan_id,
            summary: event.summary || "",
            tasks: event.tasks.map((t) => ({
              task_id: t.task_id,
              employee_name: t.employee_name || "",
              task_name: t.task_name || "",
              status: "pending" as const,
              cron: t.cron,
              execute_mode: t.execute_mode || "immediate",
            })),
          })
          store.setPlanTasks(
            event.plan_id,
            event.summary || "",
            event.tasks.map((t) => ({
              task_id: t.task_id,
              employee_name: t.employee_name || "",
              task_name: t.task_name || "",
              status: "pending" as const,
              cron: t.cron,
              execute_mode: t.execute_mode || "immediate",
            }))
          )
        }
        break
      }
      case "task_started": {
        _taskCache.set(event.task_id, {
          employee_id: event.employee_id,
          employee_name: event.employee_name,
          task_name: event.task_name,
        })
        for (const [planId, plan] of Object.entries(store.activePlans)) {
          const task = plan.tasks.find((t) => t.task_id === event.task_id)
          if (task) {
            store.updateTaskProgress(
              Number(planId),
              event.task_id,
              "running",
              event.conversation_id
            )
            break
          }
        }
        break
      }
      case "task_completed": {
        for (const [planId] of Object.entries(store.activePlans)) {
          store.updateTaskProgress(Number(planId), event.task_id, "success", event.conversation_id)
        }
        const cached = _taskCache.get(event.task_id)
        if (cached) {
          useExecutionReportsStore.getState().pushReport({
            taskId: event.task_id,
            conversationId: event.conversation_id,
            employeeId: cached.employee_id,
            employeeName: cached.employee_name,
            taskName: cached.task_name,
            status: "success",
            ts: Date.now(),
          })
          _taskCache.delete(event.task_id)
        }
        break
      }
      case "task_failed": {
        for (const [planId] of Object.entries(store.activePlans)) {
          store.updateTaskProgress(Number(planId), event.task_id, "failed", event.conversation_id)
        }
        const cachedFail = _taskCache.get(event.task_id)
        if (cachedFail) {
          useExecutionReportsStore.getState().pushReport({
            taskId: event.task_id,
            conversationId: event.conversation_id,
            employeeId: cachedFail.employee_id,
            employeeName: cachedFail.employee_name,
            taskName: cachedFail.task_name,
            status: "failed",
            ts: Date.now(),
          })
          _taskCache.delete(event.task_id)
        }
        break
      }
    }
  } catch {
    // store update failed, ignore
  }
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

  const baseUrl = (typeof window !== "undefined" &&
    (window as any).__BASE_URL__) ||
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
      bridgeEventToStore(event)
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
        console.error(`[ws-events] disconnected, reconnecting in ${Math.round(delay)}ms (attempt ${_reconnectCount}/${MAX_RECONNECT_COUNT})`)
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
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const connectionListener = (connected: boolean) => setIsConnected(connected)
    _connectionListeners.add(connectionListener)

    const wrapped: EventHandler = (event) => {
      handlerRef.current?.(event)
    }
    _handlers.add(wrapped)

    connect(1)

    return () => {
      _connectionListeners.delete(connectionListener)
      _handlers.delete(wrapped)
      if (_handlers.size === 0) {
        disconnect()
      }
    }
  }, [])

  return { isConnected }
}

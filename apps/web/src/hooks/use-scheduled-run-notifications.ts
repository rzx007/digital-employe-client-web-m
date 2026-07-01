import { useCallback } from "react"
import { getElectronApi } from "@/lib/electron/host"
import { useNotificationStore } from "@/stores/notification-store"
import { useWorkspaceEvents, type WorkspaceEvent } from "./use-workspace-events"

export function useScheduledRunNotifications() {
  const push = useNotificationStore((s) => s.push)

  const handler = useCallback(
    (event: WorkspaceEvent) => {
      if (event.type !== "scheduled_run") return

      push({
        run_id: event.run_id,
        title: event.title,
        run_seq: event.run_seq,
        conversation_id: event.conversation_id,
        ts: Date.now(),
        read: false,
      })

      getElectronApi()?.sendNotification?.(
        "定时任务已运行",
        `「${event.title}」· 第${event.run_seq}轮`,
        false
      )
    },
    [push]
  )

  useWorkspaceEvents(handler)
}

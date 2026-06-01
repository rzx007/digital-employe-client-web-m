"use client"

import { useQuery } from "@tanstack/react-query"
import { IconClock } from "@tabler/icons-react"
import { fetchRuntimeConfig } from "@/api/system"
import { cn } from "@workspace/ui/lib/utils"

export function AgentRuntimeBanner({ className }: { className?: string }) {
  const { data } = useQuery({
    queryKey: ["system", "runtime"],
    queryFn: fetchRuntimeConfig,
    refetchInterval: (query) => {
      const serial = query.state.data?.data?.agent_runtime?.serial_mode
      return serial ? 5000 : false
    },
  })

  const runtime = data?.data?.agent_runtime
  if (!runtime?.serial_mode) return null

  const queued = runtime.queued_starts ?? 0
  const active = runtime.active_streams ?? 0
  if (queued <= 0 && active <= runtime.max_concurrent_streams) return null

  const message =
    queued > 0
      ? `Agent 串行模式：${queued} 个任务排队中${active > 0 ? `，${active} 路正在执行` : ""}`
      : `Agent 串行模式：${active} 路正在执行`

  return (
    <div
      className={cn(
        "fixed right-0 bottom-0 left-0 z-50 flex items-center justify-center gap-2 bg-amber-500/90 px-4 py-2 text-center text-xs text-amber-950",
        className
      )}
      role="status"
    >
      <IconClock className="size-3.5 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  )
}

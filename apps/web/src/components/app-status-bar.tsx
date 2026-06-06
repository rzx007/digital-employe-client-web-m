"use client"

import * as React from "react"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { cn } from "@workspace/ui/lib/utils"
import {
  agentSourceLabel,
  formatAgentStatus,
  mergeRuntimeQueueItems,
} from "@/lib/runtime/format-agent-status"
import {
  useAgentRuntime,
  useOfflineMode,
  useRuntimeConfig,
} from "@/lib/runtime/runtime-provider"
import { useChatStore } from "@/stores/chat-store"

const HIDDEN_PATH_PREFIXES = [
  "/login",
  "/activation",
  "/splash",
  "/register",
]

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        online ? "bg-emerald-500" : "bg-muted-foreground/50"
      )}
      aria-hidden
    />
  )
}

function QueueList({
  running,
  waiting,
  onSelectConversation,
}: {
  running: ReturnType<typeof mergeRuntimeQueueItems>["running"]
  waiting: ReturnType<typeof mergeRuntimeQueueItems>["waiting"]
  onSelectConversation: (id: number) => void
}) {
  if (running.length === 0 && waiting.length === 0) {
    return (
      <p className="px-2 py-1 text-muted-foreground">当前无排队任务</p>
    )
  }

  return (
    <div className="flex max-h-48 flex-col gap-2 overflow-y-auto">
      {running.length > 0 ? (
        <div>
          <p className="px-2 pb-1 font-medium text-muted-foreground">
            执行中
          </p>
          <ul className="flex flex-col">
            {running.map((item) => (
              <li key={`run-${item.conversation_id}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => onSelectConversation(item.conversation_id)}
                >
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground">
                    {agentSourceLabel(item.source)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {waiting.length > 0 ? (
        <div>
          <p className="px-2 pb-1 font-medium text-muted-foreground">
            排队中
          </p>
          <ul className="flex flex-col">
            {waiting.map((item) => (
              <li key={`wait-${item.conversation_id}`}>
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-accent"
                  onClick={() => onSelectConversation(item.conversation_id)}
                >
                  <span className="block truncate font-medium">
                    {item.title}
                  </span>
                  <span className="text-muted-foreground">
                    {agentSourceLabel(item.source)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function AppStatusBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const setSelectedConversationId = useChatStore(
    (s) => s.setSelectedConversationId
  )
  const setActiveTab = useChatStore((s) => s.setActiveTab)
  const [browserOffline, setBrowserOffline] = React.useState(
    typeof navigator !== "undefined" && navigator.onLine === false
  )

  const runtimeConfig = useRuntimeConfig()
  const agent = useAgentRuntime()
  const offlineMode = useOfflineMode()

  React.useEffect(() => {
    const onOffline = () => setBrowserOffline(true)
    const onOnline = () => setBrowserOffline(false)
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)
    return () => {
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
    }
  }, [])

  if (HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null
  }

  const agentStatus = formatAgentStatus(agent)
  const { running, waiting } = mergeRuntimeQueueItems(agent)
  const deployOnline = !offlineMode
  const serialLabel = agent.serial_mode ? "串行" : "并行"

  const handleSelectConversation = (conversationId: number) => {
    setSelectedConversationId(conversationId)
    setActiveTab("chat")
    void navigate({ to: "/" })
  }

  const leftSegments = (
    <>
      <span className="inline-flex items-center gap-1.5">
        <StatusDot online={deployOnline} />
        <span>{deployOnline ? "在线" : "离线"}</span>
      </span>
      <span className="text-muted-foreground/60">·</span>
      <Link
        to="/"
        search={{ tab: "chat" }}
        className="hover:text-foreground hover:underline"
      >
        {serialLabel}
      </Link>
      <span className="text-muted-foreground/60">·</span>
      <span
        className={cn(
          agentStatus.emphasize && "text-amber-600 dark:text-amber-500"
        )}
      >
        {agentStatus.agentLabel}
      </span>
    </>
  )

  const leftContent = agentStatus.expandable ? (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1 truncate text-left hover:text-foreground"
        >
          {leftSegments}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80 p-2">
        <QueueList
          running={running}
          waiting={waiting}
          onSelectConversation={handleSelectConversation}
        />
      </PopoverContent>
    </Popover>
  ) : (
    <div className="inline-flex min-w-0 items-center gap-1 truncate">
      {leftSegments}
    </div>
  )

  const activation = runtimeConfig.activation
  const showActivation =
    activation?.enforced && activation.activated && activation.days_remaining != null

  return (
    <footer
      className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border/50 bg-muted/30 px-3 text-[11px] text-muted-foreground select-none"
      role="status"
      aria-live="polite"
    >
      <div className="min-w-0 flex-1 truncate">{leftContent}</div>
      <div className="flex shrink-0 items-center gap-3">
        {browserOffline ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <StatusDot online={false} />
            网络断开
          </span>
        ) : null}
        {showActivation ? (
          <span>授权 {activation.days_remaining} 天</span>
        ) : null}
      </div>
    </footer>
  )
}

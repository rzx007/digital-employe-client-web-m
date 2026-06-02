import * as React from "react"
import type { UIMessage } from "ai"
import {
  Message,
  MessageContent,
} from "@workspace/ui/components/ai-elements/message"
import { Shimmer } from "@workspace/ui/components/ai-elements/shimmer"
import { cn } from "@workspace/ui/lib/utils"
import { Spinner } from "@/components/spinner"

const CONNECTING_HINT_DELAY_MS = 18_000

const HINT_COPY = {
  generating: {
    title: "正在生成回复...",
    spinnerColor: "#8B5CF6",
  },
  connecting: {
    title: "连接较慢，请检查设置中的模型配置",
    spinnerColor: "#F59E0B",
  },
} as const

type StreamingHint = keyof typeof HINT_COPY

function assistantHasVisibleText(messages: UIMessage[]): boolean {
  const last = messages.at(-1)
  if (!last || last.role !== "assistant") return false
  return (
    last.parts?.some(
      (part) =>
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string" &&
        part.text.trim().length > 0
    ) ?? false
  )
}

function useStreamingHint(
  status: string,
  messages: UIMessage[]
): StreamingHint {
  const waitingForFirstToken =
    (status === "submitted" || status === "streaming") &&
    !assistantHasVisibleText(messages)

  const waitKey = waitingForFirstToken
    ? (messages.at(-1)?.id ?? status)
    : null

  const [connectingWaitKey, setConnectingWaitKey] = React.useState<
    string | null
  >(null)

  React.useEffect(() => {
    if (!waitKey) return

    const timer = window.setTimeout(() => {
      setConnectingWaitKey(waitKey)
    }, CONNECTING_HINT_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [waitKey])

  if (!waitingForFirstToken) return "generating"
  if (connectingWaitKey === waitKey) return "connecting"
  return "generating"
}

type ChatStreamingIndicatorProps = {
  status: string
  messages: UIMessage[]
  className?: string
}

export function ChatStreamingIndicator({
  status,
  messages,
  className,
}: ChatStreamingIndicatorProps) {
  const hint = useStreamingHint(status, messages)
  const copy = HINT_COPY[hint]

  return (
    <Message from="assistant" className={cn(className)}>
      <MessageContent className="rounded-lg bg-muted/40 px-3 py-2.5">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner
            className="size-3.5 shrink-0 transition-colors duration-300"
            style={{ color: copy.spinnerColor }}
          />
          <Shimmer className="text-xs">{copy.title}</Shimmer>
        </div>
      </MessageContent>
    </Message>
  )
}

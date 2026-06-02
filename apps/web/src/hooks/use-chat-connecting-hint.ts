import * as React from "react"
import type { UIMessage } from "ai"
import { toast } from "sonner"

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

/** 模型首包较慢时在 UI 侧提前提示，避免长时间只有「正在生成回复…」 */
export function useChatConnectingHint(
  status: string,
  messages: UIMessage[],
  delayMs = 18_000
) {
  const warnedRef = React.useRef(false)

  React.useEffect(() => {
    const busy = status === "submitted" || status === "streaming"
    if (!busy) {
      warnedRef.current = false
      return
    }
    if (assistantHasVisibleText(messages)) {
      return
    }

    const timer = window.setTimeout(() => {
      if (warnedRef.current || assistantHasVisibleText(messages)) return
      warnedRef.current = true
      toast.info("仍在连接模型…", {
        description:
          "若长时间无响应，请到设置检查 API Key、Base URL 与模型名称是否正确。",
        duration: 10_000,
      })
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [status, messages, delayMs])
}

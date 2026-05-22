import * as React from "react"
import { IconCheck, IconCopy } from "@tabler/icons-react"
import { toast } from "sonner"
import {
  MessageAction,
  MessageActions,
} from "@workspace/ui/components/ai-elements/message"
import { cn } from "@workspace/ui/lib/utils"

const COPIED_RESET_MS = 2000

export function MessageCopyAction({
  text,
  embedded = false,
}: {
  text: string
  /** 嵌入 MessageAssistantActions 时由父级控制 hover 显隐 */
  embedded?: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const disabled = !text.trim()

  const handleCopy = async () => {
    if (disabled) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
      toast.success("已复制到剪贴板")
    } catch {
      toast.error("复制失败，请检查剪贴板权限")
    }
  }

  return (
    <MessageActions
      className={cn(
        embedded ? "justify-start" : "justify-end",
        !embedded &&
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      )}
    >
      <MessageAction
        tooltip={copied ? "已复制" : "复制"}
        label="复制"
        disabled={disabled}
        onClick={() => void handleCopy()}
      >
        {copied ? (
          <IconCheck className="size-3.5" />
        ) : (
          <IconCopy className="size-3.5" />
        )}
      </MessageAction>
    </MessageActions>
  )
}

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Spinner } from "@/components/spinner"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { fetchMessagesByConversationId } from "@/api/chat"
import { mapStoredMessagesToUIMessages } from "@/lib/chat/message-utils"
import { classifyMessageParts } from "@/lib/chat/message-classifier"
import { BlockRenderer } from "@/components/chat/message-blocks/block-render-map"
import { chatKeys } from "@/lib/query-keys/chat"
import type { UIMessage } from "ai"

const EMPTY_COLLAPSE_MAP = new Map<string, boolean>()
const EMPTY_TOOL_COLLAPSE_MAP = new Map<string, boolean>()
const NOOP = () => {}

function AssistantMessageBlocks({
  message,
  isLast,
  conversationId,
}: {
  message: UIMessage
  isLast: boolean
  conversationId: number
}) {
  const blocks = React.useMemo(
    () => classifyMessageParts(message),
    [message]
  )
  if (blocks.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5 py-2">
      {blocks.map((block) => (
        <BlockRenderer
          key={block.key}
          block={block}
          ctx={{
            messageId: message.id,
            conversationId,
            toolAutoCollapseMap: EMPTY_TOOL_COLLAPSE_MAP,
            isLastAssistantMessage: isLast,
            isTurnEnded: true,
            onHitlApproved: NOOP,
            onSendUserMessage: async () => {},
            commandMeta: null,
            mentionMeta: [],
          }}
        />
      ))}
    </div>
  )
}

function UserMessageRow({ text }: { text: string }) {
  if (!text.trim()) return null
  return (
    <div className="flex justify-end py-2">
      <div className="max-w-[80%] rounded-2xl bg-primary/10 px-3 py-2 text-[13px] text-foreground/90">
        {text}
      </div>
    </div>
  )
}

export function SubConversationPanel({
  conversationId,
}: {
  conversationId: number
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const bottomRef = React.useRef<HTMLDivElement>(null)

  const { data: storedMessages = [], isLoading } = useQuery({
    queryKey: chatKeys.messages(String(conversationId)),
    queryFn: ({ signal }) =>
      fetchMessagesByConversationId(conversationId, { signal }),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 3000,
  })

  const messages = React.useMemo(
    () => mapStoredMessagesToUIMessages(storedMessages),
    [storedMessages]
  )

  const lastAssistantIdx = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return i
    }
    return -1
  }, [messages])

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        暂无执行记录
      </div>
    )
  }

  return (
    <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
      <div className="flex flex-col px-4 pb-6">
        {messages.map((message, idx) => {
          if (message.role === "user") {
            const text = message.parts
              .filter((p) => p.type === "text")
              .map((p) => ("text" in p ? p.text : ""))
              .join("\n")
            return <UserMessageRow key={message.id} text={text} />
          }
          if (message.role === "assistant") {
            return (
              <AssistantMessageBlocks
                key={message.id}
                message={message}
                isLast={idx === lastAssistantIdx}
                conversationId={conversationId}
              />
            )
          }
          return null
        })}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

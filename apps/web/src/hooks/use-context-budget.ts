import * as React from "react"
import type { UIMessage } from "ai"
import { useQuery } from "@tanstack/react-query"

import { fetchConversationContextBudget } from "@/api/conversation"
import type { ContextBudgetSnapshot } from "@/lib/chat/context-budget"
import { getMessageMetadataRecord } from "@/components/chat/shared/chat-view-shared"
import { parseUsageFromMessageMetadata } from "@/lib/chat/context-budget"

function findLatestUsageFromMessages(
  messages: UIMessage[]
): { input_tokens?: number; output_tokens?: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message?.role !== "assistant") continue
    const usage = parseUsageFromMessageMetadata(
      getMessageMetadataRecord(message)
    )
    if (usage?.input_tokens != null) return usage
  }
  return null
}

export function useContextBudget(
  conversationId: string | number | null | undefined,
  messages: UIMessage[],
  chatStatus: "submitted" | "streaming" | "ready" | "error"
) {
  const id = conversationId != null ? String(conversationId) : null
  const shouldPoll = chatStatus === "streaming" || chatStatus === "submitted"

  const query = useQuery({
    queryKey: ["context-budget", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetchConversationContextBudget(id!)
      return res.data ?? null
    },
    refetchInterval: shouldPoll ? 4000 : false,
    staleTime: 10_000,
  })

  const prevChatStatusRef = React.useRef(chatStatus)

  React.useEffect(() => {
    if (!id) return

    const prev = prevChatStatusRef.current
    prevChatStatusRef.current = chatStatus

    const wasBusy = prev === "streaming" || prev === "submitted"
    const isIdle = chatStatus === "ready" || chatStatus === "error"
    if (wasBusy && isIdle) {
      void query.refetch()
    }
  }, [chatStatus, id, query.refetch])

  const optimistic = React.useMemo((): ContextBudgetSnapshot | null => {
    const usage = findLatestUsageFromMessages(messages)
    const base = query.data

    if (base?.last_input_tokens != null) {
      if (
        usage?.input_tokens != null &&
        usage.input_tokens > base.last_input_tokens
      ) {
        return {
          ...base,
          last_input_tokens: usage.input_tokens,
          last_output_tokens: usage.output_tokens ?? base.last_output_tokens,
          source: base.source === "none" ? "api_usage" : base.source,
        }
      }
      return base
    }

    if (usage?.input_tokens != null) {
      const max = base?.max_input_tokens ?? 131_072
      const summarize =
        base?.summarization_threshold ?? Math.round(max * 0.75)
      const truncate =
        base?.truncate_args_threshold ?? Math.round(max * 0.5)
      const used = usage.input_tokens
      return {
        conversation_id: base?.conversation_id ?? Number(id),
        last_input_tokens: used,
        last_output_tokens: usage.output_tokens ?? null,
        max_input_tokens: max,
        summarization_threshold: summarize,
        truncate_args_threshold: truncate,
        head_tail_skip_threshold:
          base?.head_tail_skip_threshold ?? Math.round(summarize * 0.8),
        usage_percent_of_max: Math.round((used / max) * 1000) / 10,
        usage_percent_of_summarize:
          summarize > 0
            ? Math.round((used / summarize) * 1000) / 10
            : null,
        zone: base?.zone && base.zone !== "unknown" ? base.zone : "ok",
        zone_label: base?.zone_label ?? "正常",
        source: "estimated",
        last_message_id: base?.last_message_id ?? null,
      }
    }

    return base ?? null
  }, [messages, query.data, id])

  return {
    budget: optimistic,
    isLoading: query.isLoading && !optimistic,
    refetch: query.refetch,
  }
}

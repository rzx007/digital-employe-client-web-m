import { useEffect, useRef } from "react"
import type { QueryClient } from "@tanstack/react-query"
import type { UIMessage } from "ai"

import { extractResultText } from "@/lib/chat/tools/tool-part"
import { parseGroupCreatedToolPayload } from "@/lib/chat/group-created-tool-payload"
import { chatKeys } from "@/lib/query-keys/chat"

const TEAM_CHANGE_TOOLS = new Set([
  "hire_employee",
  "hire_employees",
  "update_employee",
  "delete_employee",
  "create_group_and_dispatch",
])

function isSuccessfulTeamChangePart(part: UIMessage["parts"][number]): boolean {
  if (!part || typeof part !== "object") return false
  if (!("type" in part) || typeof part.type !== "string") return false
  if (!part.type.startsWith("tool-")) return false

  const toolName = part.type.slice("tool-".length)
  if (!TEAM_CHANGE_TOOLS.has(toolName)) return false

  const state = "state" in part ? String(part.state) : ""
  if (state !== "output-available") return false

  const resultText = extractResultText(
    part as Parameters<typeof extractResultText>[0]
  )
  if (!resultText?.trim()) return false
  if (resultText.trim().startsWith("错误")) return false

  if (toolName === "create_group_and_dispatch") {
    return parseGroupCreatedToolPayload(resultText) != null
  }

  return true
}

/** 总管对话中员工增删改/录用成功后刷新左侧通讯录 */
export function useInvalidateContactsOnTeamChanges(
  messages: UIMessage[],
  status: string,
  queryClient: QueryClient
) {
  const processedRef = useRef(new Set<string>())

  useEffect(() => {
    if (status !== "ready") return

    let shouldInvalidate = false

    for (const message of messages) {
      if (message.role !== "assistant") continue
      for (const part of message.parts ?? []) {
        if (!("toolCallId" in part) || typeof part.toolCallId !== "string") {
          continue
        }
        if (processedRef.current.has(part.toolCallId)) continue
        if (!isSuccessfulTeamChangePart(part)) continue

        processedRef.current.add(part.toolCallId)
        shouldInvalidate = true
      }
    }

    if (shouldInvalidate) {
      void queryClient.invalidateQueries({ queryKey: chatKeys.contacts() })
    }
  }, [messages, status, queryClient])
}

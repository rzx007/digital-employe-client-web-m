import { useDeferredValue, useMemo } from "react"
import type { UIMessage } from "ai"
import { classifyMessageParts } from "@/lib/chat/message-classifier"
import { computeToolAutoCollapseMap } from "@/lib/chat/tool-collapse-policy"
import { getMessageMeta } from "@/components/chat/shared/chat-view-shared"

export interface UseClassifiedMessageBlocksOptions {
  includeFileChanges?: boolean
  isLastAssistantMessage?: boolean
  isTurnEnded?: boolean
}

export function useClassifiedMessageBlocks(
  message: UIMessage,
  options: UseClassifiedMessageBlocksOptions = {}
) {
  const {
    includeFileChanges = false,
    isLastAssistantMessage = false,
    isTurnEnded = true,
  } = options

  const deferredMessage = useDeferredValue(message)

  const blocks = useMemo(
    () => classifyMessageParts(deferredMessage, { includeFileChanges }),
    [deferredMessage, includeFileChanges]
  )

  const toolAutoCollapseMap = useMemo(
    () =>
      computeToolAutoCollapseMap(blocks, {
        isLastAssistantMessage,
        isTurnEnded,
      }),
    [blocks, isLastAssistantMessage, isTurnEnded]
  )

  const messageMeta = useMemo(() => getMessageMeta(deferredMessage), [deferredMessage])

  const commandMeta =
    messageMeta?.command && typeof messageMeta.command === "object"
      ? (messageMeta.command as { id?: string; title?: string })
      : null

  const mentionMeta =
    messageMeta?.mentions && Array.isArray(messageMeta.mentions)
      ? (messageMeta.mentions as Array<{ id?: string; name?: string }>)
      : []

  const filesMeta =
    messageMeta?.files && Array.isArray(messageMeta.files)
      ? (messageMeta.files as Array<{ name: string; path: string }>)
      : undefined

  return {
    blocks,
    toolAutoCollapseMap,
    messageMeta,
    commandMeta,
    mentionMeta,
    filesMeta,
  }
}

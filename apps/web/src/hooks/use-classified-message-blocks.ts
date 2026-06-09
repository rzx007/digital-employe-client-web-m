import { useDeferredValue, useEffect, useMemo } from "react"
import type { UIMessage } from "ai"
import { classifyMessageParts } from "@/lib/chat/message-classifier"
import { computeToolAutoCollapseMap } from "@/lib/chat/tool-collapse-policy"
import { getMessageMeta } from "@/components/chat/shared/chat-view-shared"
import { reportSkillInvokeOnce } from "@/lib/telemetry"

export interface UseClassifiedMessageBlocksOptions {
  includeFileChanges?: boolean
  isLastAssistantMessage?: boolean
  isTurnEnded?: boolean
}

/**
 * 从工具调用入参里兜底提取技能名：匹配路径中 `…/skills/<技能名>/…` 的首段。
 * 兼容 Windows(`\`) 与 Unix(`/`) 分隔符；要求 skills 前是分隔符，避免误匹配
 * `employees-skills`。本地技能：…\employees-skills\27\skills\html-ppt\SKILL.md → html-ppt
 */
function skillNameFromPath(input: unknown): string | null {
  if (input == null) return null
  try {
    const s = typeof input === "string" ? input : JSON.stringify(input)
    const m = s.match(/[\\/]skills[\\/]+([^\\/"\s,]+)/i)
    return m ? m[1] : null
  } catch {
    return null
  }
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

  // 活跃度埋点：回复结束后，按「技能名」上报本次回复实际用到的技能（含本地/内置技能）。
  // 技能识别来自工具调用读取技能文件；skillName 可能为空（本地技能是 Windows 绝对路径，
  // 形如 ...\employees-skills\27\skills\html-ppt\SKILL.md），故再从路径兜底提取技能名。
  useEffect(() => {
    if (!isTurnEnded) return
    if (message.role !== "assistant") return
    const names = new Set<string>()
    for (const b of blocks as Array<{
      kind?: string
      items?: Array<{ skillName?: string | null; input?: unknown }>
    }>) {
      if (b?.kind === "skill-exploration") {
        for (const it of b.items ?? []) {
          const name = it?.skillName || skillNameFromPath(it?.input)
          if (name) names.add(name)
        }
      }
    }
    names.forEach((n) => reportSkillInvokeOnce(n, `${message.id}:${n}`))
  }, [blocks, isTurnEnded, message.id, message.role])

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

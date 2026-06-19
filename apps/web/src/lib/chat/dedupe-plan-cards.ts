import type { UIMessage } from "ai"

import {
  extractResultText,
  isToolUIPart,
  type ToolUIPart,
} from "./tools/tool-part"
import { parsePlanGeneratedOutput } from "./plan-generated-payload"

/**
 * 群时间线里同一份编排计划可能被投影成**多条** room 消息：组长会话在编排过程中
 * 会断流/重连并多次终态化（见 group_room_service.project_member_conversation_if_in_room
 * 由 _finalize_task_stream 在任意终态调用），每次都把组长会话仍含 create_orchestration_plan
 * 工具调用的 message_parts 复制成新的一行 → 同一 plan_id 渲染出两张「编排计划已生成」卡。
 *
 * 这里在时间线组装层（与 stripGhostComposerAssistants 同一处）按 plan_id 去重：
 * 同一 plan_id 只保留**最后一条**消息上的计划工具 part（最新状态最权威），把更早消息里
 * 重复的计划 part 剥掉，但保留这些消息的其余内容（正文/其他工具）。不同 plan_id 互不影响，
 * 仍各自成卡。
 */

function getPlanIdFromToolPart(part: ToolUIPart): number | null {
  if (part.type !== "tool-create_orchestration_plan") return null
  const resultText = extractResultText(part)
  const output = parsePlanGeneratedOutput(resultText)
  return output?.plan_id ?? null
}

export function dedupePlanCardsByPlanId(messages: UIMessage[]): UIMessage[] {
  // 1) 找出每个 plan_id 最后一次出现的消息下标（最新一条权威）。
  const lastIndexByPlanId = new Map<number, number>()
  for (let i = 0; i < messages.length; i++) {
    for (const part of messages[i].parts) {
      if (!isToolUIPart(part)) continue
      const planId = getPlanIdFromToolPart(part)
      if (planId != null) lastIndexByPlanId.set(planId, i)
    }
  }

  // 没有任何重复（每个 plan_id 至多出现一次的消息）→ 原样返回，避免无谓重建。
  const seenCount = new Map<number, number>()
  for (let i = 0; i < messages.length; i++) {
    for (const part of messages[i].parts) {
      if (!isToolUIPart(part)) continue
      const planId = getPlanIdFromToolPart(part)
      if (planId != null) {
        seenCount.set(planId, (seenCount.get(planId) ?? 0) + 1)
      }
    }
  }
  const hasDuplicate = [...seenCount.values()].some((n) => n > 1)
  if (!hasDuplicate) return messages

  // 2) 剥掉非「最后一条」消息上的重复计划 part。
  return messages.map((message, index) => {
    let removed = false
    const nextParts = message.parts.filter((part) => {
      if (!isToolUIPart(part)) return true
      const planId = getPlanIdFromToolPart(part)
      if (planId == null) return true
      if (lastIndexByPlanId.get(planId) === index) return true
      removed = true
      return false
    })
    if (!removed) return message
    return { ...message, parts: nextParts }
  })
}

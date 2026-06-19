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

/**
 * 共用的剥离逻辑：给定「每个去重键最后一次出现的消息下标」(lastIndexByKey) 与
 * 「从计划 part 取去重键」的函数 (keyOf)，只在最后一条消息上保留该键的计划 part，
 * 其余消息上同键的计划 part 剥掉、保留其余内容。没有任何剥离 → 原样返回 messages
 * （保持同引用 no-op）。
 */
function stripDuplicatePlanParts(
  messages: UIMessage[],
  lastIndexByKey: Map<string, number>,
  keyOf: (part: ToolUIPart) => string | null
): UIMessage[] {
  // 一条消息内也可能有同 key 的多个计划 part（组长一轮调两次 create，结果都落在
  // 同一条消息上）。仅靠「最后一条消息」判定会把同消息里的多个都保留 → 渲染多张卡。
  // 因此在胜出消息上，只保留该 key 的**最后一个** part，更早的同 key part 也剥掉。
  const lastPartPosByKeyOnWinner = new Map<string, number>()
  messages.forEach((message, index) => {
    message.parts.forEach((part, pos) => {
      if (!isToolUIPart(part)) return
      const key = keyOf(part)
      if (key == null) return
      if (lastIndexByKey.get(key) === index) {
        lastPartPosByKeyOnWinner.set(key, pos)
      }
    })
  })

  let changed = false
  const next = messages.map((message, index) => {
    let removed = false
    const nextParts = message.parts.filter((part, pos) => {
      if (!isToolUIPart(part)) return true
      const key = keyOf(part)
      if (key == null) return true
      // 只在「胜出消息」且是该 key 在该消息上的最后一个 part 时保留。
      if (
        lastIndexByKey.get(key) === index &&
        lastPartPosByKeyOnWinner.get(key) === pos
      ) {
        return true
      }
      removed = true
      return false
    })
    if (!removed) return message
    changed = true
    return { ...message, parts: nextParts }
  })
  return changed ? next : messages
}

export function dedupePlanCardsByPlanId(messages: UIMessage[]): UIMessage[] {
  // 找出每个 plan_id 最后一次出现的消息下标（最新一条权威），并统计重复。
  const lastIndexByKey = new Map<string, number>()
  const keyOf = (part: ToolUIPart): string | null => {
    const planId = getPlanIdFromToolPart(part)
    return planId != null ? `p${planId}` : null
  }
  for (let i = 0; i < messages.length; i++) {
    for (const part of messages[i].parts) {
      if (!isToolUIPart(part)) continue
      const key = keyOf(part)
      if (key != null) lastIndexByKey.set(key, i)
    }
  }

  // 剥掉非「最后一条」消息上的重复计划 part；无重复 → 同引用原样返回。
  return stripDuplicatePlanParts(messages, lastIndexByKey, keyOf)
}

/**
 * 一轮里组长可能产出**多份不同 plan_id** 的计划，后端给每份计划盖上同一条组长助理消息的
 * `message_id`。按 plan_id 去重无法把它们折叠成一张卡。这里改为优先按 message_id 折叠：
 * 同一 message_id 下的多份计划只在最新一条消息上保留一张计划卡。缺 message_id（meta 缺失
 * 或为 null）时回退到 plan_id 行为——只与同 plan_id 折叠，不因都缺 message_id 而误并。
 *
 * @param planMetaById plan_id -> { messageId } 映射（来自 orchestrationPlans 查询）。
 */
export function dedupePlanCardsByMessageId(
  messages: UIMessage[],
  planMetaById: Map<number, { messageId: number | null }>
): UIMessage[] {
  const keyOf = (part: ToolUIPart): string | null => {
    const planId = getPlanIdFromToolPart(part)
    if (planId == null) return null
    const messageId = planMetaById.get(planId)?.messageId ?? null
    return messageId != null ? `m${messageId}` : `p${planId}`
  }

  const lastIndexByKey = new Map<string, number>()
  for (let i = 0; i < messages.length; i++) {
    for (const part of messages[i].parts) {
      if (!isToolUIPart(part)) continue
      const key = keyOf(part)
      if (key != null) lastIndexByKey.set(key, i)
    }
  }

  return stripDuplicatePlanParts(messages, lastIndexByKey, keyOf)
}

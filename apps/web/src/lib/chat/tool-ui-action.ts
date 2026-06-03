import type { UIMessage } from "ai"

import { getMessageMetadataRecord } from "@/components/chat/shared/chat-view-shared"

/** 用户消息 metadata：对话展示用（模型仍收到 text / content 原文） */
export const UI_ACTION_DISPLAY_TEXT_KEY = "displayText"
export const UI_ACTION_KIND_KEY = "uiAction"

export type ToolUiActionKind =
  | "recruitment_hire_one"
  | "recruitment_hire_batch"
  | "plan_confirm"
  | "plan_cancel"

export interface ToolUiActionOutbound {
  agentText: string
  displayText: string
  uiAction: ToolUiActionKind
}

export function toolUiActionMetadata(
  outbound: ToolUiActionOutbound
): Record<string, unknown> {
  return {
    [UI_ACTION_DISPLAY_TEXT_KEY]: outbound.displayText,
    [UI_ACTION_KIND_KEY]: outbound.uiAction,
  }
}

export function getToolUiActionFromMessage(
  message: UIMessage
): { displayText: string; uiAction?: ToolUiActionKind } | null {
  const meta = getMessageMetadataRecord(message)
  const displayRaw = meta?.[UI_ACTION_DISPLAY_TEXT_KEY]
  if (typeof displayRaw !== "string" || !displayRaw.trim()) return null

  const kindRaw = meta?.[UI_ACTION_KIND_KEY]
  const uiAction =
    kindRaw === "recruitment_hire_one" ||
    kindRaw === "recruitment_hire_batch" ||
    kindRaw === "plan_confirm" ||
    kindRaw === "plan_cancel"
      ? kindRaw
      : undefined

  return { displayText: displayRaw.trim(), uiAction }
}

function getMessagePlainText(message: UIMessage): string {
  return message.parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        p.type === "text" && "text" in p && typeof p.text === "string"
    )
    .map((p) => p.text)
    .join("")
    .trim()
}

/** 旧消息无 metadata 时，从 Agent 指令反推用户可见摘要 */
export function resolveLegacyUserActionDisplayText(
  agentText: string
): { displayText: string; uiAction?: ToolUiActionKind } | null {
  const text = agentText.trim()
  if (!text) return null

  const planConfirm = text.match(
    /^【手动操作】我已在卡片上确认执行编排计划 #(\d+)(?:（([^）]+)）)?/
  )
  if (planConfirm) {
    const summary = planConfirm[2]?.trim()
    return {
      displayText: summary
        ? `已确认执行编排计划「${summary}」`
        : `已确认执行编排计划 #${planConfirm[1]}`,
      uiAction: "plan_confirm",
    }
  }

  const planCancel = text.match(
    /^【手动操作】我已在卡片上取消编排计划 #(\d+)(?:（([^）]+)）)?/
  )
  if (planCancel) {
    const summary = planCancel[2]?.trim()
    return {
      displayText: summary
        ? `已取消编排计划「${summary}」`
        : `已取消编排计划 #${planCancel[1]}`,
      uiAction: "plan_cancel",
    }
  }

  const hireOne = text.match(/^录用「([^」]+)」/m)
  if (hireOne && !text.includes("hire_employees")) {
    return {
      displayText: `已录用候选人：${hireOne[1].trim()}`,
      uiAction: "recruitment_hire_one",
    }
  }

  const hireAll = text.match(/^全部录用以下\s+(\d+)\s+位候选人/)
  if (hireAll) {
    const count = hireAll[1]
    const names: string[] = []
    try {
      const jsonStart = text.indexOf("[")
      if (jsonStart >= 0) {
        const parsed: unknown = JSON.parse(text.slice(jsonStart))
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object" && "name" in item) {
              const n = (item as { name: unknown }).name
              if (typeof n === "string" && n.trim()) names.push(n.trim())
            }
          }
        }
      }
    } catch {
      // ignore
    }
    const nameSuffix =
      names.length > 0
        ? `：${names.slice(0, 5).join("、")}${names.length > 5 ? " 等" : ""}`
        : ""
    return {
      displayText: `已请求录用 ${count} 位候选人${nameSuffix}`,
      uiAction: "recruitment_hire_batch",
    }
  }

  return null
}

export function resolveUserMessageDisplay(
  message: UIMessage
): { displayText: string; uiAction?: ToolUiActionKind } | null {
  if (message.role !== "user") return null

  const fromMeta = getToolUiActionFromMessage(message)
  if (fromMeta) return fromMeta

  const plain = getMessagePlainText(message)
  if (!plain) return null
  return resolveLegacyUserActionDisplayText(plain)
}

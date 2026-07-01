import type { UIMessage } from "ai"

import { mergeConsecutiveAssistantMessages } from "../merge-consecutive-assistant-messages"
import { enrichHitlResolvedPartsInMessage } from "./display-enrich"
import { dedupeHitlPartsInMessages } from "./parts-dedupe"

/** 列表渲染：merge → enrich HITL input → dedupe pending parts */
export function prepareDisplayMessages(messages: UIMessage[]): UIMessage[] {
  const merged = mergeConsecutiveAssistantMessages(messages)
  const enriched = merged.map(enrichHitlResolvedPartsInMessage)
  return dedupeHitlPartsInMessages(enriched)
}

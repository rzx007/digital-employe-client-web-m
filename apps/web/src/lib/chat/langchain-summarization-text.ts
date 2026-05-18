import type { UIMessage } from "ai"

/** 与 LangGraph messages 元数据 `lc_source: "summarization"` 对应，写入 text part.providerMetadata */
export const LANGCHAIN_SUMMARIZATION_TEXT_PROVIDER_METADATA = {
  langchain: { lcSource: "summarization" as const },
} as const

export function isSummarizationTextPart(
  part: UIMessage["parts"][number]
): boolean {
  if (part.type !== "text") return false
  const pm = (part as { providerMetadata?: unknown }).providerMetadata
  if (!pm || typeof pm !== "object") return false
  const langchain = (pm as { langchain?: unknown }).langchain
  if (!langchain || typeof langchain !== "object") return false
  return (
    (langchain as { lcSource?: unknown }).lcSource === "summarization"
  )
}

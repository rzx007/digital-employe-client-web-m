import type { UIMessage } from "ai"

/**
 * 模型「思考过程」(reasoning_content) 文本流标记。
 *
 * 与 summarization 流同构：reasoning 增量经后端 PromptCacheChatOpenAI 捞回
 * `additional_kwargs.reasoning_content`，解析器把它当一条独立 text 流发出、
 * 写入 text part.providerMetadata，classifier 据此恒定渲染为思考块（不受工具
 * 位置影响）。
 */
export const LANGCHAIN_REASONING_TEXT_PROVIDER_METADATA = {
  langchain: { lcSource: "reasoning" as const },
} as const

export function isReasoningTextPart(part: UIMessage["parts"][number]): boolean {
  if (part.type !== "text") return false
  const pm = (part as { providerMetadata?: unknown }).providerMetadata
  if (!pm || typeof pm !== "object") return false
  const langchain = (pm as { langchain?: unknown }).langchain
  if (!langchain || typeof langchain !== "object") return false
  return (langchain as { lcSource?: unknown }).lcSource === "reasoning"
}

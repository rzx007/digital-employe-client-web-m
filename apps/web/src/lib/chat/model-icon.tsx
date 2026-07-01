import type { ComponentType, SVGProps } from "react"
import DeepSeekIcon from "@/icons/DeepSeek"
import GeminiIcon from "@/icons/Gemini"
import OpenAiIcon from "@/icons/OpenAi"
import QwenIcon from "@/icons/Qwen"

export type ModelIconComponent = ComponentType<SVGProps<SVGSVGElement>>

export function getModelIcon(
  model: string | null | undefined
): ModelIconComponent {
  const normalizedModel = model?.toLowerCase().trim() || ""

  if (
    normalizedModel.includes("deepseek") ||
    normalizedModel.includes("deep-seek")
  ) {
    return DeepSeekIcon
  }

  if (normalizedModel.includes("gemini") || normalizedModel.includes("gemma")) {
    return GeminiIcon
  }

  if (
    normalizedModel.includes("qwen") ||
    normalizedModel.includes("qwq") ||
    normalizedModel.includes("dashscope")
  ) {
    return QwenIcon
  }

  return OpenAiIcon
}

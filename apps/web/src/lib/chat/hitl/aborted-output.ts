import { DESTRUCTIVE_DELETE_REJECT_MESSAGE } from "./constants"

export function isHitlAbortedOutput(resultText?: string | null): boolean {
  if (!resultText) return false
  return (
    resultText.includes("已中止") ||
    resultText.includes("已跳过") ||
    resultText.includes("已取消")
  )
}

export function isDestructiveDeleteRejected(
  resultText?: string | null
): boolean {
  if (!resultText) return false
  const text = resultText.trim()
  return text === DESTRUCTIVE_DELETE_REJECT_MESSAGE || isHitlAbortedOutput(text)
}

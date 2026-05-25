export function isHitlAbortedOutput(resultText?: string | null): boolean {
  if (!resultText) return false
  return (
    resultText.includes("已中止") ||
    resultText.includes("已跳过") ||
    resultText.includes("已取消")
  )
}

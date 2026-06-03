/**
 * 工具结果 payload 解析的共享小工具。
 *
 * 收敛前这两个函数在多个 `*-payload.ts` 里各有一份完全等价的实现
 * （`parseJsonObject` × 5、`asNumber` × 5），改一处忘其它处会导致解析行为不一致。
 */

/** 把工具结果文本解析为 JSON 对象；非 `{...}` 对象（含数组/标量/损坏）一律返回 null。 */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** 宽松数字转换：number 直接用；非空数字字符串转 number；其余返回 null（NaN/Infinity 视为 null）。 */
export function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

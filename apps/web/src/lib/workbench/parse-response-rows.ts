/**
 * 从 API JSON 中解析表格行，与数据板块图表逻辑一致（供多处复用）
 */

export interface ParsedResponseRows {
  headers: string[]
  rows: Record<string, unknown>[]
}

/** APIs often return numbers as JSON strings */
export function isNumericLike(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true
  if (typeof v === "string") {
    const t = v.trim()
    if (t === "") return false
    const n = Number(t)
    return Number.isFinite(n)
  }
  return false
}

/** Columns that are mostly numeric-like in a sample of rows */
export function inferNumericKeys(headers: string[], rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return []
  const sample = rows.slice(0, Math.min(50, rows.length))
  return headers.filter((h) => {
    let ok = 0
    let total = 0
    for (const row of sample) {
      const v = row[h]
      if (v === null || v === undefined || v === "") continue
      total++
      if (isNumericLike(v)) ok++
    }
    return total > 0 && ok / total >= 0.6
  })
}

/** Prefer a non-numeric column for category / X axis */
export function inferLabelKey(
  headers: string[],
  rows: Record<string, unknown>[],
  numericKeys: Set<string>
): string {
  const first = rows[0]
  if (!first) return headers[0] ?? ""
  for (const h of headers) {
    if (numericKeys.has(h)) continue
    const v = first[h]
    if (v !== null && v !== undefined && typeof v !== "object") {
      return h
    }
  }
  const fallback = headers.find((h) => !numericKeys.has(h))
  return fallback ?? headers[0] ?? ""
}

export function parseResponseData(response: unknown, responseFormat?: string): ParsedResponseRows {
  if (!response || typeof response !== "object") {
    return { headers: [], rows: [] }
  }

  const dataObj = response as Record<string, unknown>

  if (responseFormat) {
    const pathParts = responseFormat.split(".")
    let current: unknown = dataObj
    for (const part of pathParts) {
      if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[part]
      } else {
        current = null
        break
      }
    }
    if (Array.isArray(current)) {
      const rows = (current as unknown[]).filter(
        (item) => typeof item === "object" && item !== null
      ) as Record<string, unknown>[]
      if (rows.length > 0) {
        return {
          headers: Object.keys(rows[0]),
          rows,
        }
      }
    }
  }

  if (Array.isArray(dataObj)) {
    const rows = dataObj.filter((item) => typeof item === "object" && item !== null) as Record<string, unknown>[]
    if (rows.length > 0) {
      return {
        headers: Object.keys(rows[0]),
        rows,
      }
    }
    return { headers: [], rows: [] }
  }

  const dataKeys = ["data", "list", "result", "records", "items", "results", "rows", "array", "values"]
  for (const key of dataKeys) {
    if (dataObj[key] && Array.isArray(dataObj[key])) {
      const rows = (dataObj[key] as unknown[]).filter(
        (item) => typeof item === "object" && item !== null
      ) as Record<string, unknown>[]
      if (rows.length > 0) {
        return {
          headers: Object.keys(rows[0]),
          rows,
        }
      }
    }
  }

  const keys = Object.keys(dataObj)
  if (keys.length > 0) {
    return {
      headers: keys,
      rows: [dataObj],
    }
  }

  return { headers: [], rows: [] }
}

/**
 * Resolve `{placeholder}` / `{{placeholder}}` in API URL templates to concrete values.
 * Uses local calendar date/time (not UTC) so "today" matches user timezone.
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Local YYYY-MM-DD */
export function formatLocalDateYYYYMMDD(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** Local `YYYY-MM-DDTHH:mm:ss` (no spaces, safe in query strings) */
export function formatLocalDateTime(d = new Date()): string {
  return `${formatLocalDateYYYYMMDD(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function resolvePlaceholderValue(paramName: string): string {
  const p = paramName.trim()
  const lower = p.toLowerCase()

  if (
    lower.includes("datetime") ||
    lower === "date_time" ||
    (lower.includes("date") && lower.includes("time") && lower !== "timestamp")
  ) {
    return formatLocalDateTime(new Date())
  }

  if (lower === "timestamp" || lower.endsWith("_ts") || lower === "unix" || lower === "epoch") {
    return String(Date.now())
  }

  if (lower.includes("date") || lower.includes("day") || lower === "d" || lower.endsWith("_d")) {
    return formatLocalDateYYYYMMDD(new Date())
  }

  if (lower.includes("time") && !lower.includes("date")) {
    const d = new Date()
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  }

  return ""
}

/**
 * Fix URLs where `{param` lost the closing `}` (e.g. old skill extract trimmed trailing `}`).
 */
export function repairIncompletePlaceholderBraces(url: string): string {
  const t = url.trim()
  if (/\{[a-zA-Z][a-zA-Z0-9_.-]*$/.test(t)) {
    return `${t}}`
  }
  return t
}

/**
 * Replace `{{name}}` then `{name}` so double-brace templates are supported.
 */
export function applyUrlTemplatePlaceholders(url: string): string {
  let out = url
  out = out.replace(/\{\{([^}]+)\}\}/g, (_, param) => resolvePlaceholderValue(param))
  out = out.replace(/\{([^}]+)\}/g, (_, param) => resolvePlaceholderValue(param))
  return out
}

/**
 * Join base URL and relative path (e.g. `queryCalendar/...?dateTime={x}`) with a single slash.
 */
export function joinBaseUrlAndPath(baseUrl: string, path: string): string {
  const p = path.trim()
  const b = baseUrl.trim()
  if (!b) return p

  try {
    const base = b.endsWith("/") ? b : `${b}/`
    const rel = p.startsWith("/") ? p.slice(1) : p
    return new URL(rel, base).href
  } catch {
    const left = b.replace(/\/+$/, "")
    const right = p.replace(/^\//, "")
    return `${left}/${right}`
  }
}

/**
 * Full URL for fetch: join base + path when needed, then substitute placeholders.
 */
export function buildFetchUrlFromInterface(path: string, baseUrl?: string): string {
  let raw = repairIncompletePlaceholderBraces(path.trim())
  if (raw.startsWith("http")) {
    return applyUrlTemplatePlaceholders(raw)
  }
  const joined = joinBaseUrlAndPath(baseUrl || "", raw)
  return applyUrlTemplatePlaceholders(repairIncompletePlaceholderBraces(joined))
}

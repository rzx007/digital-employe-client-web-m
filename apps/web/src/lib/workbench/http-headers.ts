/**
 * Normalize headers from AI / form input (object, JSON string, or [{name,value}]).
 */
export function normalizeHeadersFromUnknown(
  raw: unknown
): Record<string, string> | undefined {
  if (raw == null) return undefined

  if (typeof raw === "string") {
    const t = raw.trim()
    if (!t) return undefined
    try {
      const parsed = JSON.parse(t) as unknown
      return objectToHeaderRecord(parsed)
    } catch {
      return undefined
    }
  }

  if (Array.isArray(raw)) {
    const out: Record<string, string> = {}
    for (const item of raw) {
      if (!item || typeof item !== "object") continue
      const o = item as Record<string, unknown>
      const name = o.name ?? o.key
      const value = o.value ?? o.val
      if (typeof name === "string" && name.trim() && value != null) {
        out[name.trim()] = String(value).trim()
      }
    }
    return Object.keys(out).length ? out : undefined
  }

  if (typeof raw === "object") {
    return objectToHeaderRecord(raw)
  }

  return undefined
}

function headerValueToString(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === "string") {
    const t = v.trim()
    return t.length ? t : null
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v)
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false"
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    if (
      v.every(
        (x) =>
          x === null ||
          typeof x === "string" ||
          typeof x === "number" ||
          typeof x === "boolean"
      )
    ) {
      return v.map((x) => (x == null ? "" : String(x))).join(", ")
    }
    return JSON.stringify(v)
  }
  if (typeof v === "object") {
    return JSON.stringify(v)
  }
  const s = String(v).trim()
  return s.length ? s : null
}

function objectToHeaderRecord(
  raw: unknown
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = headerValueToString(v)
    if (s) out[k] = s
  }
  return Object.keys(out).length ? out : undefined
}

/** Header names we accept from free-form `Name: value` lines (avoids matching `Note: ...`). */
const HEADER_NAME_PATTERN =
  /^(?:Authorization|authorization|Accept|Cookie|Content-Type|X-[A-Za-z0-9\-]+|Api-Key|apikey|token|Token|access_token|access-token|user|username|uid|referer|origin)$/i

function stripInlineComment(s: string): string {
  return s
    .replace(/\s*\/\/.*$/, "")
    .replace(/\s*#.*$/, "")
    .trim()
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    return t.slice(1, -1)
  }
  return t
}

/** When JSON.parse fails (JS object with unquoted keys), extract `key: 'value' | "value"` pairs */
function parseLooseJsStyleHeaderObject(
  slice: string
): Record<string, string> | undefined {
  const out: Record<string, string> = {}
  for (const m of slice.matchAll(
    /([A-Za-z][A-Za-z0-9\-]*)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g
  )) {
    const v = m[2] ?? m[3] ?? m[4] ?? ""
    if (v.trim()) out[m[1]] = v.trim()
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Parse JSON object starting at `{`, respecting strings so nested `{` in values works.
 */
function parseBalancedJsonObject(
  text: string,
  openBraceIndex: number
): Record<string, string> | undefined {
  if (text[openBraceIndex] !== "{") return undefined
  let depth = 0
  let inString = false
  let escape = false
  for (let j = openBraceIndex; j < text.length; j++) {
    const c = text[j]
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (c === "\\") {
        escape = true
        continue
      }
      if (c === '"') inString = false
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === "{") depth++
    else if (c === "}") {
      depth--
      if (depth === 0) {
        const slice = text.slice(openBraceIndex, j + 1)
        try {
          const parsed = JSON.parse(slice) as Record<string, unknown>
          return objectToHeaderRecord(parsed)
        } catch {
          return parseLooseJsStyleHeaderObject(slice)
        }
      }
    }
  }
  return undefined
}

/** Merge all `headers` / `requestHeaders` / JS `headers: { ... }` objects from text */
function mergeHeaderJsonObjects(
  text: string,
  into: Record<string, string>
): void {
  const patterns: RegExp[] = [
    /["']headers["']\s*:\s*\{/gi,
    /["']requestHeaders["']\s*:\s*\{/gi,
    /["']request_headers["']\s*:\s*\{/gi,
    /["']header["']\s*:\s*\{/gi,
    /\bheaders\s*:\s*\{/gi,
  ]
  for (const re of patterns) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const braceStart = m.index + m[0].length - 1
      const rec = parseBalancedJsonObject(text, braceStart)
      if (rec) Object.assign(into, rec)
    }
  }
}

/** `请求头：{ "Authorization": "..." }` */
function extractChineseHeadersJson(
  text: string,
  into: Record<string, string>
): void {
  const re = /请求头\s*[：:]\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const braceStart = m.index + m[0].length - 1
    const rec = parseBalancedJsonObject(text, braceStart)
    if (rec) Object.assign(into, rec)
  }
}

/** `curl ... -H "Name: Value"` and `-H 'Name: Value'` */
function extractFromCurlHeaders(
  text: string,
  into: Record<string, string>
): void {
  for (const m of text.matchAll(/-H\s+["']([^"']+)["']/gi)) {
    const raw = m[1]
    const idx = raw.indexOf(":")
    if (idx <= 0) continue
    const name = raw.slice(0, idx).trim()
    const value = stripQuotes(raw.slice(idx + 1).trim())
    if (name && value) into[name] = value
  }
}

/** Markdown table: | Authorization | Bearer xxx | */
function extractFromMarkdownHeaderTables(
  text: string,
  into: Record<string, string>
): void {
  const headerCols =
    /\|\s*(Authorization|X-Api-Key|X-API-KEY|Content-Type|Accept|Cookie|Api-Key)\s*\|\s*([^|]*?)\s*\|/gi
  for (const m of text.matchAll(headerCols)) {
    const name = m[1].trim()
    let value = m[2].trim()
    if (!value) continue
    if (name.toLowerCase() === "api-key" || name === "X-API-KEY")
      into["X-Api-Key"] = stripQuotes(value)
    else into[name] = stripQuotes(value)
  }
}

/**
 * Chinese skill blocks: `请求头：` followed by markdown list; values may continue on the next line(s)
 * when `- name:` has an empty same-line value (common for long base64 tokens).
 */
function extractRequestHeadersSection(
  text: string,
  into: Record<string, string>
): void {
  const blockRe =
    /请求头\s*[：:]?\s*\n([\s\S]*?)(?=\n\s*(?:响应示例|响应\s*[：:]|#\s|$))/i
  const bm = text.match(blockRe)
  if (!bm) return

  const section = bm[1]
  const lines = section.split(/\r?\n/)
  const listItemRe = /^\s*[-*]\s*([A-Za-z0-9\-]+)\s*:\s*(.*)$/
  let pendingName: string | null = null

  for (const line of lines) {
    const m = line.match(listItemRe)
    if (m) {
      const name = m[1]
      const value = m[2].trim()
      if (value) {
        into[name] = value
        pendingName = null
      } else {
        /* 值在后续行：清空同名头，避免与上文 JSON/其它解析结果拼接导致重复一整段 */
        delete into[name]
        pendingName = name
      }
      continue
    }
    if (pendingName) {
      const t = line.trim()
      if (!t) continue
      if (into[pendingName]) {
        into[pendingName] += t
      } else {
        into[pendingName] = t
      }
    }
  }
}

/**
 * Lines like `Authorization: Bearer xxx` (start of line or after list marker / quote).
 */
function extractFromHeaderLines(
  text: string,
  into: Record<string, string>
): void {
  const lineRe =
    /^\s*(?:[-*+]|[\d]+[.)])?\s*(?:>\s*)?(?:`)?\s*([A-Za-z0-9\-]+)\s*:\s*(.+?)\s*$/gm
  for (const m of text.matchAll(lineRe)) {
    const name = m[1]
    if (!HEADER_NAME_PATTERN.test(name)) continue
    let value = stripInlineComment(m[2].trim())
    value = stripQuotes(value)
    if (!value) continue
    into[name] = value
  }
}

/** Standalone `Bearer <jwt>` when no Authorization yet */
function extractBearerToken(text: string, into: Record<string, string>): void {
  if (into.Authorization) return
  const bare = text.match(/\bBearer\s+(\S+)/)
  if (bare?.[1]) into.Authorization = `Bearer ${bare[1]}`
}

/**
 * `token: xxx` / `access_token=xxx` in prose
 */
function extractTokenAliases(text: string, into: Record<string, string>): void {
  if (into.Authorization) return
  const t1 = text.match(
    /(?:^|[\s,;])(?:token|access_token|accessToken)\s*[:=]\s*["']?([^\s"',\n}]+)/im
  )
  if (t1?.[1]) {
    const v = t1[1].trim()
    into.Authorization = v.startsWith("Bearer ") ? v : `Bearer ${v}`
  }
}

/**
 * Best-effort extraction of request headers from skill markdown / code / tables.
 */
export function extractHeadersFromSkillText(
  text: string
): Record<string, string> {
  const out: Record<string, string> = {}

  mergeHeaderJsonObjects(text, out)
  extractChineseHeadersJson(text, out)
  extractRequestHeadersSection(text, out)
  extractFromCurlHeaders(text, out)
  extractFromMarkdownHeaderTables(text, out)
  extractFromHeaderLines(text, out)
  extractBearerToken(text, out)
  extractTokenAliases(text, out)

  return out
}

/**
 * Headers for `fetch()`: custom headers from interface, plus default Content-Type for non-GET when missing.
 */
export function buildFetchHeadersInit(queryInterface: {
  method?: string
  headers?: Record<string, string>
}): HeadersInit {
  const method = (queryInterface.method || "GET").toUpperCase()
  const custom = queryInterface.headers ?? {}
  const out: Record<string, string> = { ...custom }
  if (method !== "GET" && method !== "HEAD") {
    const hasCt = Object.keys(out).some(
      (k) => k.toLowerCase() === "content-type"
    )
    if (!hasCt) out["Content-Type"] = "application/json"
  }
  return out
}

/** Merge base headers with optional JSON override string from UI */
export function mergeHeadersJsonOverride(
  base: Record<string, string> | undefined,
  jsonOverride: string | undefined
): Record<string, string> | undefined {
  const merged: Record<string, string> = { ...(base || {}) }
  const t = jsonOverride?.trim()
  if (t) {
    try {
      const parsed = JSON.parse(t) as unknown
      const rec = normalizeHeadersFromUnknown(parsed)
      if (rec) Object.assign(merged, rec)
    } catch {
      /* invalid JSON — ignore override */
    }
  }
  return Object.keys(merged).length ? merged : undefined
}

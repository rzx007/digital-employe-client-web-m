import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"
import { extractHeadersFromSkillText } from "@/lib/workbench/http-headers"

/**
 * Trim trailing punctuation often captured with URLs in prose.
 * Do not strip `}` — URLs like `?dateTime={target_date}` must keep the closing brace
 * or placeholder replacement will break.
 */
function trimUrlTrailingJunk(s: string): string {
  return s
    .replace(/[.,;:!?)]+$/g, "")
    .replace(/\]+$/g, "")
    .trim()
}

/** Stable key for dedup / merge (full URLs normalized; otherwise lowercased) */
export function normalizePathKey(path: string): string {
  const p = path.trim()
  if (!p) return ""
  try {
    if (p.startsWith("http")) {
      const u = new URL(p)
      return `${u.origin}${u.pathname}${u.search}`.toLowerCase()
    }
  } catch {
    /* ignore */
  }
  return p.toLowerCase()
}

function normalizePathnameTrailingSlash(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1)
  }
  return pathname === "" ? "/" : pathname
}

/**
 * URL key for matching AI-returned paths to interface paths: sorted query params,
 * normalized pathname trailing slash, lowercase origin — reduces false misses when
 * the model reorders ?a=1&b=2 or omits a trailing slash.
 */
export function normalizePathKeyForMatch(path: string): string {
  const p = path.trim()
  if (!p) return ""
  try {
    if (p.startsWith("http")) {
      const u = new URL(p)
      const pathname = normalizePathnameTrailingSlash(u.pathname)
      const params = new URLSearchParams(u.search)
      const sorted = [...params.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
      )
      const sp = new URLSearchParams()
      for (const [key, val] of sorted) {
        sp.append(key, val)
      }
      const q = sp.toString()
      const search = q ? `?${q}` : ""
      return `${u.origin}${pathname}${search}`.toLowerCase()
    }
  } catch {
    /* ignore */
  }
  return p.toLowerCase()
}

/** origin + pathname (no query), for fuzzy header lookup */
export function originPathnameKey(path: string): string | null {
  try {
    if (path.trim().startsWith("http")) {
      const u = new URL(path)
      const pathname = normalizePathnameTrailingSlash(u.pathname)
      return `${u.origin}${pathname}`.toLowerCase()
    }
  } catch {
    /* ignore */
  }
  return null
}

function shortHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++)
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36).slice(0, 8)
}

/** 在技能正文中定位 URL 的起始下标（支持完整串或 pathname+search） */
function findUrlIndexInBlob(blob: string, url: string): number {
  const t = url.trim()
  if (!t) return -1
  let i = blob.indexOf(t)
  if (i >= 0) return i
  try {
    const u = new URL(t)
    const full = `${u.origin}${u.pathname}${u.search}`
    i = blob.indexOf(full)
    if (i >= 0) return i
    i = blob.indexOf(u.pathname + u.search)
    if (i >= 0) return i
  } catch {
    /* ignore */
  }
  return -1
}

/**
 * 取该 URL 在正文中**上方**最近的 Markdown 标题（#～######），用于同技能多接口的标题/描述区分
 */
export function extractMarkdownHeadingBeforeUrl(
  blob: string,
  url: string
): string | null {
  const idx = findUrlIndexInBlob(blob, url)
  if (idx < 0) return null
  const before = blob.slice(0, idx)
  const lines = before.split(/\r?\n/)
  let last: string | null = null
  for (const line of lines) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*$/)
    if (m) last = m[1].trim()
  }
  return last && last.length > 0 ? last : null
}

/**
 * 从技能 Markdown/示例 JSON 中解析行内注释：`"fieldName": ...,//中文说明` 或 `... "//x"//说明`
 */
export function extractFieldLabelsFromSkillText(
  text: string
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/"([^"]+)"\s*:\s*[^/\n]*?(?:,\s*)?\/\/\s*(.+)$/)
    if (!m) continue
    const key = m[1].trim()
    let zh = m[2].trim()
    zh = zh.replace(/\s*\/\/.*$/, "").trim()
    if (key && zh) out[key] = zh
  }
  return out
}

/** 取「该 URL 之后到下一处 http(s) 之前」的片段，避免多接口字段说明串台 */
export function extractFieldLabelsForUrlInSkillBlob(
  blob: string,
  url: string
): Record<string, string> {
  const idx = blob.indexOf(url)
  if (idx < 0) return extractFieldLabelsFromSkillText(blob)
  const after = blob.slice(idx + url.length)
  const nextHttp = after.search(/https?:\/\//)
  const section = nextHttp >= 0 ? after.slice(0, nextHttp) : after
  return extractFieldLabelsFromSkillText(section)
}

/** Raw http(s) URLs appearing in text */
export function extractUrlsFromSkillText(text: string): string[] {
  const urlRe = /https?:\/\/[^\s"'<>\]\)]+/gi
  const ordered: string[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(urlRe)) {
    const u = trimUrlTrailingJunk(m[0])
    if (!u.startsWith("http") || u.length <= 10) continue
    const k = normalizePathKey(u)
    if (!k || seen.has(k)) continue
    seen.add(k)
    ordered.push(u)
  }
  return ordered
}

/** Lines like `GET http://host/api` or `POST https://...` */
export function extractMethodUrlPairs(
  text: string
): { method: QueryInterface["method"]; url: string }[] {
  const re = /\b(GET|POST|PUT|DELETE)\s+(https?:\/\/[^\s]+)/gi
  const out: { method: QueryInterface["method"]; url: string }[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(re)) {
    const url = trimUrlTrailingJunk(m[2])
    const k = normalizePathKey(url)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push({ method: m[1].toUpperCase() as QueryInterface["method"], url })
  }
  return out
}

/**
 * Programmatically discover query-like HTTP endpoints from skill text.
 * Used as ground truth for URLs so the model cannot invent hosts/paths.
 */
export function buildHeuristicQueryInterfaces(
  skills: MetadataSkill[]
): QueryInterface[] {
  const globalSeen = new Set<string>()
  const out: QueryInterface[] = []

  for (const s of skills) {
    // 兼容 status 为数字 1 或字符串 "1"，无 status 字段也默认启用
    if (s.status !== undefined && s.status !== 1 && s.status !== "1") continue

    // 构建技能文本 blob，包含 skillContent（本地技能的主要内容）
    const blob = [
      s.skillName,
      s.description,
      s.prompt,
      s.skillContent || s.skill_content, // 添加技能内容
    ]
      .filter(Boolean)
      .join("\n\n")
    console.log("blob", blob)
    const headerHints = extractHeadersFromSkillText(blob)
    const pairs = extractMethodUrlPairs(blob)
    const bareUrls = extractUrlsFromSkillText(blob)

    const urlToMethod = new Map<string, QueryInterface["method"]>()
    for (const { method, url } of pairs) {
      urlToMethod.set(normalizePathKey(url), method)
    }

    const urlsOrdered: string[] = []
    const pushUrl = (u: string) => {
      const k = normalizePathKey(u)
      if (!k || globalSeen.has(k)) return
      globalSeen.add(k)
      urlsOrdered.push(u)
    }

    for (const { url } of pairs) pushUrl(url)
    for (const u of bareUrls) pushUrl(u)

    urlsOrdered.forEach((url, i) => {
      const method = urlToMethod.get(normalizePathKey(url)) ?? "GET"
      const fieldLabels = extractFieldLabelsForUrlInSkillBlob(blob, url)
      const sectionTitle = extractMarkdownHeadingBeforeUrl(blob, url)
      const fallbackDesc =
        (s.description || "").slice(0, 280) ||
        `来自技能「${s.skillName}」正文中的接口地址`
      const name = sectionTitle
        ? sectionTitle
        : urlsOrdered.length > 1
          ? `接口 ${i + 1}`
          : "数据接口"
      const description = sectionTitle || fallbackDesc
      out.push({
        id: `heuristic-${s.id}-${i}-${shortHash(url)}`,
        name,
        description,
        method,
        path: url,
        baseUrl: "",
        headers: Object.keys(headerHints).length ? { ...headerHints } : {},
        ...(Object.keys(fieldLabels).length > 0 ? { fieldLabels } : {}),
      })
    })
  }

  return out
}

/** Reduce hallucinated AI paths: must appear in skill text (or share host/path with it) */
export function pathMentionedInSkills(
  path: string,
  skillBlob: string
): boolean {
  const p = path.trim()
  if (!p) return false
  if (skillBlob.includes(p)) return true
  const compactBlob = skillBlob.replace(/\s+/g, "")
  if (compactBlob.includes(p.replace(/\s+/g, ""))) return true
  try {
    if (p.startsWith("http")) {
      const u = new URL(p)
      return skillBlob.includes(u.host) && skillBlob.includes(u.pathname)
    }
  } catch {
    /* ignore */
  }
  return false
}

function genInterfaceId(): string {
  return `interface-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Merge AI-extracted metadata into heuristic URLs (exact path preserved from skills).
 */
export function mergeHeuristicAndAiResults(
  heuristic: QueryInterface[],
  aiItems: Omit<QueryInterface, "id">[],
  skillBlob: string
): QueryInterface[] {
  const keyOf = normalizePathKey

  const merged: QueryInterface[] = []
  const usedAiKeys = new Set<string>()

  for (const h of heuristic) {
    const hk = keyOf(h.path)
    const ai = aiItems.find((a) => a.path && keyOf(a.path) === hk)
    if (ai) {
      usedAiKeys.add(keyOf(ai.path))
      merged.push({
        ...h,
        name: ai.name?.trim() || h.name,
        description: ai.description?.trim() || h.description,
        method: ai.method || h.method,
        path: h.path,
        baseUrl: ai.baseUrl?.trim() || h.baseUrl || "",
        headers: { ...h.headers, ...ai.headers },
        responseFormat: ai.responseFormat ?? h.responseFormat,
        fieldBinding: ai.fieldBinding ?? h.fieldBinding,
        chartType: ai.chartType ?? h.chartType,
        fieldLabels: { ...h.fieldLabels, ...ai.fieldLabels },
      })
    } else {
      merged.push(h)
    }
  }

  for (const raw of aiItems) {
    if (!raw.path?.trim()) continue
    const k = keyOf(raw.path)
    if (usedAiKeys.has(k)) continue
    if (!pathMentionedInSkills(raw.path, skillBlob)) continue
    if (merged.some((m) => keyOf(m.path) === k)) continue

    merged.push({
      ...(raw as QueryInterface),
      id: genInterfaceId(),
      method: raw.method || "GET",
      fieldLabels: raw.fieldLabels,
    })
  }

  return merged
}

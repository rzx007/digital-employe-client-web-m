import type { QueryInterface } from "@/types/workbench"
import { request } from "@/lib/request"
import { normalizeHeadersFromUnknown } from "@/lib/workbench/http-headers"
import {
  normalizePathKeyForMatch,
  originPathnameKey,
} from "@/lib/workbench/skill-url-extract"

const WORKSPACE_ID = 1

/** Lines likely describing HTTP headers / auth (pulled to front so truncation keeps them) */
const HEADER_RELEVANT_LINE =
  /token|鉴权|授权|Authorization|Bearer|请求头|\bheaders?\b|Cookie|Api-Key|apikey|X-[A-Za-z0-9\-]{2,}|密钥|access_token|租户|tenant|appkey|app-id|appid|签名|signature|ak\b|sk\b|secret/i

/**
 * Put header-relevant lines first, then head + tail of full text so long skills still expose ends.
 */
export function buildSkillContextForHeaderAi(skillBlob: string, maxChars: number): string {
  const lines = skillBlob.split(/\r?\n/)
  const hot: string[] = []
  const cold: string[] = []
  for (const line of lines) {
    if (HEADER_RELEVANT_LINE.test(line)) hot.push(line)
    else cold.push(line)
  }
  const hotBlock = hot.join("\n")
  const coldText = cold.join("\n")
  const sep = "\n\n--- 技能正文（完整顺序）---\n\n"
  let combined = hotBlock + (hotBlock && coldText ? sep : "") + coldText

  if (combined.length <= maxChars) {
    return combined
  }

  const tailLen = Math.min(12000, Math.floor(maxChars * 0.35))
  const tail = skillBlob.slice(-tailLen)
  const budget = maxChars - tail.length - 80
  const head = combined.slice(0, Math.max(0, budget))
  return `${head}\n\n…(中间已省略 ${skillBlob.length - head.length - tailLen} 字)…\n\n--- 正文末尾 ---\n${tail}`
}

function extractJsonArrayFromAiText(aiText: string): unknown[] | null {
  const stripped = aiText
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*$/gm, "")
    .trim()

  const tryParse = (s: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(s) as unknown
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  const direct = tryParse(stripped)
  if (direct) return direct

  const start = stripped.indexOf("[")
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < stripped.length; i++) {
    const c = stripped[i]
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
    if (c === "[") depth++
    else if (c === "]") {
      depth--
      if (depth === 0) {
        const slice = stripped.slice(start, i + 1)
        const arr = tryParse(slice)
        if (arr) return arr
        break
      }
    }
  }

  const loose = stripped.match(/\[[\s\S]*\]/)
  if (loose) return tryParse(loose[0])
  return null
}

/**
 * Resolve AI-returned headers for an interface path when exact string differs
 * (query order, trailing slash, encoding). Falls back to origin+pathname unique
 * match, then merges all entries sharing the same origin+pathname if multiple.
 */
export function lookupAiHeadersForPath(
  ifacePath: string,
  byKey: Map<string, Record<string, string>>
): Record<string, string> | undefined {
  const exact = normalizePathKeyForMatch(ifacePath)
  if (byKey.has(exact)) {
    return byKey.get(exact)
  }

  const op = originPathnameKey(ifacePath)
  if (!op) {
    return undefined
  }

  const matches: Record<string, string>[] = []
  for (const [key, headers] of byKey) {
    const kop = originPathnameKey(key)
    if (kop !== null && kop === op) {
      matches.push(headers)
    }
  }

  if (matches.length === 0) {
    return undefined
  }
  if (matches.length === 1) {
    return matches[0]
  }
  return matches.reduce((acc, h) => ({ ...acc, ...h }), {} as Record<string, string>)
}

/**
 * Second-pass: ask the model to infer HTTP headers from unstructured skill prose
 * when regex/heuristics miss non-standard descriptions.
 * Local / already-parsed headers win on key collision.
 */
export async function enrichInterfacesHeadersWithAi(
  employeeId: string,
  interfaces: QueryInterface[],
  skillBlob: string
): Promise<QueryInterface[]> {
  if (interfaces.length === 0) return interfaces

  const pathsPayload = interfaces.map((i) => ({
    path: i.path,
    existingHeaders:
      i.headers && Object.keys(i.headers).length > 0 ? i.headers : undefined,
  }))

  /** 控制上下文长度以缩短请求头补全大模型耗时（仍优先保留含鉴权/头的行） */
  const ctx = buildSkillContextForHeaderAi(skillBlob, 28000)

  const prompt = `你是 HTTP 与 API 文档分析助手。技能正文可能极不规范（口语、表格、多段分散说明）。请为下列每个 URL 输出**尽量完整**的 HTTP 请求头集合。

必须做到：
1. **穷尽正文**：凡正文中与该接口/该系统相关的请求头都要写入（常见如 Authorization、X-Api-Key、Cookie、Content-Type、Accept、租户/App/签名类自定义头 X-*、中文说明对应的英文头名等）。同一技能里若写「所有接口都要带 xxx 头」，应对**每个**列出的 path 都带上。
2. **合并分散信息**：表格一行、脚注、括号内、代码片段里的头名与取值都要汇总进同一 path 的 headers 对象。
3. path 必须与列表中字符串**完全一致**（含查询串、{占位符}）。
4. existingHeaders 中的键必须保留；你补充的键与之合并为**完整**输出（不要丢键）。
5. 无依据的头不要编造；说不清的可用占位或省略该键。

待分析接口（含已有头）：
${JSON.stringify(pathsPayload, null, 2)}

技能正文（已把含鉴权/头信息的行优先排在前面，并尽量附带原文首尾）：
${ctx}

只返回 JSON 数组：[{"path":"…","headers":{…}}]，不要 Markdown。headers 要尽可能包含正文提到的全部相关请求头。`

  try {
    const res = await request<{
      code: number
      data: { response: string }
    }>(`/workspaces/${WORKSPACE_ID}/chat/send`, {
      method: "POST",
      body: JSON.stringify({
        question: prompt,
        employee_id: employeeId || "system",
      }),
    })

    const arr = extractJsonArrayFromAiText(res.data.response)
    if (!arr) return interfaces

    const byKey = new Map<string, Record<string, string>>()
    for (const item of arr) {
      if (!item || typeof item !== "object") continue
      const o = item as Record<string, unknown>
      const path = typeof o.path === "string" ? o.path.trim() : ""
      if (!path) continue
      const h = normalizeHeadersFromUnknown(o.headers)
      if (!h || Object.keys(h).length === 0) continue
      const k = normalizePathKeyForMatch(path)
      const prev = byKey.get(k)
      byKey.set(k, prev ? { ...prev, ...h } : { ...h })
    }

    return interfaces.map((iface) => {
      const aiH = lookupAiHeadersForPath(iface.path, byKey)
      const local = iface.headers || {}
      if (!aiH) return iface
      const merged = { ...aiH, ...local }
      return { ...iface, headers: Object.keys(merged).length ? merged : iface.headers }
    })
  } catch (e) {
    console.error("enrichInterfacesHeadersWithAi failed:", e)
    return interfaces
  }
}

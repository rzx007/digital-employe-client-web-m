import type { MetadataSkill } from "@/api/types"
import type { QueryInterface } from "@/types/workbench"
import { request } from "@/lib/request"
import { enrichInterfacesHeadersWithAi } from "@/lib/workbench/ai-extract-headers"
import { resolveEmployeeIdForChatSend, WORKBENCH_CHAT_SEND_TIMEOUT_MS } from "@/lib/workbench/chat-send-employee"
import { normalizeHeadersFromUnknown } from "@/lib/workbench/http-headers"
import {
  buildHeuristicQueryInterfaces,
  mergeHeuristicAndAiResults,
} from "@/lib/workbench/skill-url-extract"

const WORKSPACE_ID = 1

function isAbortError(e: unknown): boolean {
  if (e == null || typeof e !== "object") return false
  return (e as { name?: string }).name === "AbortError"
}

function extractJsonArrayFromAiText(aiText: string): unknown[] | null {
  const stripped = aiText
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```\s*$/gm, "")
    .trim()
  const match = stripped.match(/\[[\s\S]*\]/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    return Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function normalizeAiItem(raw: Record<string, unknown>): Omit<QueryInterface, "id"> | null {
  const path = typeof raw.path === "string" ? raw.path.trim() : ""
  if (!path) return null

  const methodRaw = typeof raw.method === "string" ? raw.method.toUpperCase() : "GET"
  const method = (["GET", "POST", "PUT", "DELETE"].includes(methodRaw)
    ? methodRaw
    : "GET") as QueryInterface["method"]

  const headers = normalizeHeadersFromUnknown(raw.headers)

  let fieldBinding: QueryInterface["fieldBinding"]
  if (raw.fieldBinding && typeof raw.fieldBinding === "object" && raw.fieldBinding !== null) {
    const fb = raw.fieldBinding as Record<string, unknown>
    fieldBinding = {
      labelField: typeof fb.labelField === "string" ? fb.labelField : undefined,
      valueFields: Array.isArray(fb.valueFields)
        ? fb.valueFields.filter((x): x is string => typeof x === "string")
        : undefined,
    }
  }

  let fieldLabels: QueryInterface["fieldLabels"]
  if (raw.fieldLabels && typeof raw.fieldLabels === "object" && raw.fieldLabels !== null && !Array.isArray(raw.fieldLabels)) {
    const fl: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw.fieldLabels as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) fl[k] = v.trim()
    }
    if (Object.keys(fl).length > 0) fieldLabels = fl
  }

  return {
    name: typeof raw.name === "string" ? raw.name : "接口",
    description: typeof raw.description === "string" ? raw.description : "",
    method,
    path,
    baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
    headers,
    responseFormat: typeof raw.responseFormat === "string" ? raw.responseFormat : undefined,
    fieldBinding,
    fieldLabels,
    chartType: raw.chartType as QueryInterface["chartType"] | undefined,
  }
}

function needsHeaderEnrichmentAi(interfaces: QueryInterface[]): boolean {
  return interfaces.some((i) => !i.headers || Object.keys(i.headers).length === 0)
}

/**
 * 程序已从正文提取到 URL 时跳过大模型「接口分析」：名称/描述/fieldLabels/headers 已由启发式生成，
 * responseFormat / fieldBinding 可在添加模块后由样例请求与 analyzeResponseFields 补全。
 */
async function fetchInterfaceAnalysisAiItems(
  chatEmployeeId: number,
  skillDescriptions: string,
  heuristicJson: string,
  signal?: AbortSignal,
): Promise<Omit<QueryInterface, "id">[]> {
  const aiPrompt = `你是接口分析助手。下面「程序已从技能正文中提取到的 http(s) 地址」是权威列表：你必须为这些地址补充名称、描述、响应结构说明等，**禁止编造技能正文中不存在的 URL 或域名**；若技能里还有未被程序列出的查询接口（例如写在表格或图片里但正文未出现完整 URL），也不要新增，除非该 URL 的字符串确实出现在上面的技能原文中。

程序提取的接口候选（path 必须与最终 JSON 中的 path 完全一致，不要改主机名、端口、路径或查询串）：
${heuristicJson.length > 2 ? heuristicJson : "[]（程序未从正文匹配到 URL，请仅从下方技能原文中提取出现的 http(s) 完整地址）"}

规则：
1. path 字段必须是技能原文中出现过的完整 URL（含 http/https），或与程序候选列表中的 path 完全一致。
2. method 以技能正文为准（如写明 POST 则用 POST）；未写明时 GET 接口用 GET。
3. baseUrl 仅填协议+主机+端口（如 http://192.168.1.1:8080），path 仍为完整 URL 时可与 path 推导一致；不要臆造。
4. headers：**尽量写全**——正文中与该接口相关的全部请求头（鉴权、Cookie、Content-Type、各类 X-* 自定义头、多段分散说明要合并进同一对象）。可从 curl、表格、HTTP 原文、口语描述中提取；不得臆造密钥；若某头仅在技能层级说明「所有请求都要带」，应对每个接口都写上。
5. responseFormat：根据正文中的响应示例，填写数据数组所在 JSON 路径，如 "data"、"data.list"、"result.records"。
6. fieldBinding：若示例中有明确字段名，可给出 labelField / valueFields；否则可省略。
7. fieldLabels：若响应示例中字段旁有中文注释（如 //月份、//单价），必须提取为对象，键为 JSON 字段名、值为中文说明；程序也会从正文解析，你可补充或校正。
8. 忽略明显的写操作（删除、批量删除）若用户明确只要查询类；若技能只有查询接口则全部返回。
9. name：仅写该接口的中文功能名（可与正文小节标题一致），**不要**包含技能文件名、**不要**「技能名·」类前缀；**不要**在 name 里写 GET/POST 等方法字样。

技能全文：
${skillDescriptions}

请只返回 JSON 数组，不要 Markdown、不要解释。元素字段：
name, description, method, path, baseUrl（可选）, headers（可选）, responseFormat（可选）, fieldBinding（可选）, fieldLabels（可选，字段名→中文说明）

示例：
[{"name":"交易日历","description":"查询日历","method":"GET","path":"http://192.168.1.1:8080/api/calendar","baseUrl":"http://192.168.1.1:8080","responseFormat":"data"}]`

  const res = await request<{
    code: number
    data: {
      response: string
    }
  }>(`/workspaces/${WORKSPACE_ID}/chat/send`, {
    method: "POST",
    body: JSON.stringify({
      question: aiPrompt,
      employee_id: chatEmployeeId,
    }),
    timeout: WORKBENCH_CHAT_SEND_TIMEOUT_MS,
    ...(signal ? { signal } : {}),
  })

  const aiText = res.data.response
  const arr = extractJsonArrayFromAiText(aiText)
  if (!arr) return []
  return arr
    .map((item) =>
      typeof item === "object" && item !== null
        ? normalizeAiItem(item as Record<string, unknown>)
        : null
    )
    .filter((x): x is Omit<QueryInterface, "id"> => x !== null)
}

/**
 * Parse skill prompts via AI, grounded by programmatic URL extraction from skill text.
 * **skills** 应为当前用户选中的技能（通常一条）；不要将工作台列表中的全部技能拼入请求。
 * 性能：正文已能解析出 URL 时跳过「接口分析」大模型调用；各接口已有解析出的请求头时跳过「请求头补全」大模型调用。
 */
export async function parseInterfacesFromSkills(
  employeeId: string,
  skills: MetadataSkill[],
  chatEmployeeId?: number | null,
  opts?: { signal?: AbortSignal },
): Promise<QueryInterface[]> {
  if (skills.length === 0) {
    return []
  }

  const numericChatId = resolveEmployeeIdForChatSend(employeeId, chatEmployeeId)

  // 兼容 status 为数字 1 或字符串 "1"，无 status 字段也默认启用
  const enabled = skills.filter((s) => s.status === undefined || s.status === 1 || s.status === "1")
  const heuristic = buildHeuristicQueryInterfaces(enabled)

  const skillBlob = enabled
    .map((s) => `【${s.skillName}】\n${s.description || s.skill_description || ""}\n${s.prompt || ""}\n${s.skillContent || s.skill_content || ""}`)
    .join("\n\n---\n\n")

  const heuristicJson = JSON.stringify(
    heuristic.map((h) => ({
      path: h.path,
      method: h.method,
      skillHint: h.name,
    })),
    null,
    0
  )

  const skillDescriptions = enabled
    .map((s) => {
      return `【技能: ${s.skillName || s.skill_name || ""}】\n描述: ${s.description || s.skill_description || ""}\nPrompt:\n${s.prompt || ""}\n技能内容:\n${s.skillContent || s.skill_content || ""}`
    })
    .join("\n\n")

  let merged: QueryInterface[]
  let aiItems: Omit<QueryInterface, "id">[] = []

  const signal = opts?.signal

  // Always call AI to get enriched interface information (responseFormat, fieldBinding, etc.)
  try {
    aiItems = await fetchInterfaceAnalysisAiItems(
      numericChatId,
      skillDescriptions,
      heuristicJson,
      signal,
    )
  } catch (e) {
    if (isAbortError(e)) throw e
    console.error("Failed to parse interfaces from skills (AI):", e)
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError")
  }

  merged = mergeHeuristicAndAiResults(heuristic, aiItems, skillBlob)
  if (merged.length === 0) {
    merged = heuristic
  }

  if (merged.length === 0) {
    return []
  }

  if (needsHeaderEnrichmentAi(merged)) {
    return enrichInterfacesHeadersWithAi(
      numericChatId,
      merged,
      skillBlob,
      signal,
    )
  }

  return merged
}

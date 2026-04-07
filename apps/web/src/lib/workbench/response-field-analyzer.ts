import type { QueryInterface } from "@/types/workbench"
import { buildFetchHeadersInit } from "@/lib/workbench/http-headers"
import { buildFetchUrlFromInterface } from "@/lib/workbench/url-template-params"
import {
  inferLabelKey,
  inferNumericKeys,
  parseResponseData,
} from "@/lib/workbench/parse-response-rows"

interface FieldBindingResult {
  labelField?: string
  valueFields?: string[]
}

/**
 * 与数据板块图表一致的启发式字段绑定（不调用大模型 / chat/send，避免添加模块时依赖聊天接口）
 */
export function inferFieldBindingFromSample(
  sampleData: unknown,
  responseFormat?: string
): FieldBindingResult {
  const { headers, rows } = parseResponseData(sampleData, responseFormat)
  if (rows.length === 0 || headers.length === 0) return {}
  const inferred = inferNumericKeys(headers, rows)
  const numericSet = new Set(inferred)
  const labelField = inferLabelKey(headers, rows, numericSet)
  return {
    labelField: labelField || undefined,
    valueFields: inferred.length > 0 ? inferred : undefined,
  }
}

/**
 * 根据样例响应推断 labelField / valueFields（本地启发式，无网络请求）
 */
export async function analyzeResponseFields(
  queryInterface: QueryInterface,
  sampleData: unknown
): Promise<FieldBindingResult> {
  return inferFieldBindingFromSample(sampleData, queryInterface.responseFormat)
}

/**
 * Fetch sample data from an interface to analyze
 */
export async function fetchSampleData(
  queryInterface: QueryInterface
): Promise<unknown> {
  const url = buildFetchUrlFromInterface(queryInterface.path, queryInterface.baseUrl)

  try {
    const response = await fetch(url, {
      method: queryInterface.method || "GET",
      headers: buildFetchHeadersInit(queryInterface),
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return await response.json()
  } catch (e) {
    console.error("Failed to fetch sample data:", e)
    return null
  }
}

import { session } from "electron"
import { createLogger } from "../../core/logger"

const log = createLogger("preview:cors")

const NETWORK_URL_FILTER = ["http://*/*", "https://*/*"]

/**
 * 沙箱预览 iframe（看板 HTML，srcdoc + 无 allow-same-origin）发出的跨域请求，其 Origin 头为
 * "null"（不透明源）。这些请求若打到不支持 CORS 的第三方接口会被浏览器拦（Failed to fetch）。
 * 本 guard 仅对「Origin 为 null」的响应补 Access-Control-Allow-* 头放行——app 自身的请求带真实
 * Origin（http://localhost:3399 等），不受影响，安全面收敛到「页面内已是不透明源」的预览内容。
 *
 * 仅作用于 app 内的预览 iframe；导出的 HTML 在外部浏览器打开时没有此主进程加持，仍受第三方
 * 接口 CORS 限制（属预期，那种场景应使用数据内联的快照看板）。
 */

let guardRegistered = false

/** 记录「请求 id → 该请求 Origin 是否为 null」，供响应阶段判定是否补头 */
const nullOriginRequestIds = new Set<number>()

/** 请求 Origin 头是否为 "null"（沙箱不透明源特征） */
export function hasNullOrigin(
  requestHeaders: Record<string, string | string[]>,
): boolean {
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (key.toLowerCase() !== "origin") continue
    const v = Array.isArray(value) ? value[0] : value
    return v === "null"
  }
  return false
}

/** 删除响应头里已存在的同名头（大小写不敏感），避免重复/冲突 */
function stripHeader(
  headers: Record<string, string[] | string>,
  name: string,
): void {
  const lower = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) delete headers[key]
  }
}

/** 在原响应头基础上，覆盖写入放行用的 Access-Control-Allow-* 头 */
export function buildCorsResponseHeaders(
  original: Record<string, string[] | string> | undefined,
): Record<string, string[] | string> {
  const responseHeaders = { ...(original ?? {}) }
  // Origin 为 null 的非凭据请求，ACAO 用 "*" 即可放行
  stripHeader(responseHeaders, "access-control-allow-origin")
  stripHeader(responseHeaders, "access-control-allow-methods")
  stripHeader(responseHeaders, "access-control-allow-headers")
  responseHeaders["Access-Control-Allow-Origin"] = ["*"]
  responseHeaders["Access-Control-Allow-Methods"] = [
    "GET, POST, PUT, DELETE, OPTIONS",
  ]
  responseHeaders["Access-Control-Allow-Headers"] = ["*"]
  return responseHeaders
}

export function registerPreviewCorsGuard(): void {
  if (guardRegistered) return
  guardRegistered = true

  const ses = session.defaultSession

  ses.webRequest.onBeforeSendHeaders(
    { urls: NETWORK_URL_FILTER },
    (details, callback) => {
      if (hasNullOrigin(details.requestHeaders)) {
        nullOriginRequestIds.add(details.id)
      }
      callback({ requestHeaders: details.requestHeaders })
    },
  )

  ses.webRequest.onHeadersReceived(
    { urls: NETWORK_URL_FILTER },
    (details, callback) => {
      if (!nullOriginRequestIds.has(details.id)) {
        callback({ responseHeaders: details.responseHeaders })
        return
      }
      nullOriginRequestIds.delete(details.id)
      callback({
        responseHeaders: buildCorsResponseHeaders(details.responseHeaders),
      })
    },
  )

  // 请求出错/被取消时清理，避免 id 泄漏
  ses.webRequest.onErrorOccurred(
    { urls: NETWORK_URL_FILTER },
    (details) => {
      nullOriginRequestIds.delete(details.id)
    },
  )

  log.info("preview CORS guard registered")
}

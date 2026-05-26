import { ofetch } from "ofetch"
import { isElectron, withElectronApi } from "@/lib/electron/host"
import { isOfflineModeFlag } from "@/lib/runtime/runtime-provider"

const defaultHeaders: HeadersInit = {
  Accept: "application/json",
}

const server_url = `${import.meta.env.VITE_BACKEND_URL}:${import.meta.env.VITE_BACKEND_PORT}`

const fallbackBaseURL = isElectron()
  ? server_url
  : import.meta.env.DEV
    ? "/actus"
    : server_url

/**
 * KV 中的通讯（远端）地址，供 apps/server 转发；渲染进程发 HTTP 时不得以此作为 base。
 */
let cachedRemoteApiBaseUrl: string | null = null

/** 解析出 pathname + search，便于归一化；绝对 URL 字符串也会归一成路径 */
function normalizeRequestPathLike(request: unknown): string {
  if (typeof request === "string") {
    if (request.startsWith("http://") || request.startsWith("https://")) {
      try {
        const u = new URL(request)
        return `${u.pathname}${u.search}`
      } catch {
        return request
      }
    }
    return request
  }
  if (typeof URL !== "undefined" && request instanceof URL)
    return `${request.pathname}${request.search}`
  if (typeof Request !== "undefined" && request instanceof Request) {
    try {
      const u = new URL(request.url)
      return `${u.pathname}${u.search}`
    } catch {
      return ""
    }
  }
  return ""
}

/**
 * 相对 base（如 dev 的 `/actus`）下，不能以 `/foo` 作为 path，否则 URL 合并会丢掉 `/actus`
 *（最终命中 Vite 根路径而非代理）。应使用 base `/actus/` + path `foo...`。
 */
function mergeBaseAndPath(
  baseRaw: string,
  pathLike: string
): { baseURL: string; path: string } {
  if (/^https?:\/\//i.test(baseRaw)) {
    return { baseURL: baseRaw, path: pathLike }
  }
  if (baseRaw.startsWith("/")) {
    const baseURL = baseRaw.endsWith("/") ? baseRaw : `${baseRaw}/`
    const rest = pathLike.startsWith("/") ? pathLike.slice(1) : pathLike
    return { baseURL, path: rest }
  }
  return { baseURL: baseRaw, path: pathLike }
}

async function loadRemoteApiBaseFromKv(): Promise<void> {
  if (typeof window === "undefined") return
  try {
    const kvMerge = mergeBaseAndPath(
      fallbackBaseURL,
      "/config-kvs/REMOTE_API_BASE_URL"
    )
    const res = await ofetch<{
      data?: { config_value?: string }
    }>(kvMerge.path, {
      baseURL: kvMerge.baseURL,
      headers: { ...defaultHeaders },
      timeout: 10000,
      retry: 1,
      retryDelay: 2000,
    })
    const endpoint = res?.data?.config_value?.trim()
    if (endpoint) {
      cachedRemoteApiBaseUrl = endpoint
    }
  } catch {
    // ignore
  }
}

/** 配置里的远端通讯地址（若有）；业务请求仍应走本地网关 */
export function getCachedRemoteApiBaseUrl(): string | null {
  return cachedRemoteApiBaseUrl
}

export function getRequestBaseUrl() {
  const base = fallbackBaseURL
  if (typeof window === "undefined") {
    return /^https?:\/\//i.test(base) ? base : "http://localhost"
  }
  return new URL(base || "/", window.location.origin).toString()
}

export function getAuthToken() {
  if (typeof window === "undefined") {
    return null
  }
  return localStorage.getItem("token")
}

export function getRequestHeaders(customHeaders?: HeadersInit) {
  const nextHeaders = new Headers({
    ...defaultHeaders,
    ...(customHeaders instanceof Headers
      ? Object.fromEntries(customHeaders.entries())
      : customHeaders),
  })

  const token = getAuthToken()
  if (token) {
    nextHeaders.set("token", `${token}`)
  }

  return nextHeaders
}

export const request = ofetch.create({
  baseURL: fallbackBaseURL,
  headers: { ...defaultHeaders },
  timeout: 50000,
  retry: 2,
  retryDelay: 1000,
  async onRequest(ctx) {
    const pathLike = normalizeRequestPathLike(ctx.request)
    const merged = mergeBaseAndPath(fallbackBaseURL, pathLike)
    ctx.options.baseURL = merged.baseURL
    if (typeof ctx.request === "string") {
      ctx.request = merged.path
    }
    const headers = new Headers(ctx.options?.headers)
    const token = getAuthToken()
    if (token) {
      headers.set("token", `${token}`)
    }

    const workspaceId = localStorage.getItem("workspaceId")
    if (workspaceId) {
      headers.set("X-Workspace-Id", workspaceId)
    }

    const body = ctx.options?.body
    const isFormData =
      typeof FormData !== "undefined" && body instanceof FormData
    const isJsonLikeBody =
      body != null &&
      typeof body === "object" &&
      !isFormData &&
      !(body instanceof Blob) &&
      !(body instanceof URLSearchParams)

    if (isJsonLikeBody) {
      headers.set("Content-Type", "application/json")
    } else if (isFormData) {
      headers.delete("Content-Type")
    }

    ctx.options.headers = headers
  },
  async onRequestError() {},
  async onResponse() {},
  async onResponseError({ response }) {
    if (isOfflineModeFlag) return
    const status = response?.status
    if (status === 401 || status === 403) {
      localStorage.removeItem("token")
      if (isElectron()) {
        await withElectronApi((api) => api.clearAuth(), { silent: true })
      }
      if (typeof window !== "undefined") {
        window.location.hash = "#/login"
      }
    }
  },
})

/**
 * 同步 KV 中的远端通讯地址到内存（不写浏览器请求的 base）。
 * 登录页保存通讯配置后调用，便于其它模块读取。
 */
export function updateRequestBaseUrl(url: string) {
  const t = url.trim()
  cachedRemoteApiBaseUrl = t || null
}

/** 本地 Python 后端 base（开发为 `/actus` 或打包同源端口） */
export function getServerBaseUrl(): string {
  return fallbackBaseURL
}

if (typeof window !== "undefined") {
  void loadRemoteApiBaseFromKv()
}

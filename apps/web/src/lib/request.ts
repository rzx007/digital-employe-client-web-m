import { ofetch } from "ofetch"

/**
 * 默认请求头
 */
const defaultHeaders: HeadersInit = {
  Accept: "application/json",
  "Content-Type": "application/json",
}

const isElectron = !!(typeof window !== "undefined" && window.electronApi)

const baseURL = "/actus"

const headers = { ...defaultHeaders }

export function getRequestBaseUrl() {
  if (typeof window === "undefined") {
    return baseURL || "http://localhost"
  }

  return new URL(baseURL || "/", window.location.origin).toString()
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
  baseURL,
  headers,
  async onRequest(ctx) {
    const token = getAuthToken()
    if (token && ctx.options?.headers) {
      ; (ctx.options.headers as Headers).set("token", `${token}`)
    }
  },
  async onRequestError() { },
  async onResponse() { },
  async onResponseError({ response }) {
    const status = response?.status
    if (status === 401 || status === 403) {
      // token 失效：清除本地存储并跳转登录页
      localStorage.removeItem("token")
      await window.electronApi?.clearAuth()
      if (typeof window !== "undefined") {
        window.location.hash = "#/login"
      }
    }
  },
})

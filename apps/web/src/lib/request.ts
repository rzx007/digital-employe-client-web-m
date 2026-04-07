import { ofetch } from "ofetch"

/**
 * 默认请求头
 */
const defaultHeaders: HeadersInit = {
  Accept: "application/json",
  "Content-Type": "application/json",
}

const isElectron = !!(typeof window !== "undefined" && window.electronApi)

const baseURL = isElectron
  ? "http://localhost:58000"
  : import.meta.env.DEV
    ? "/actus"
    : "http://localhost:58000"

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
    nextHeaders.set("Authorization", `Bearer ${token}`)
  }

  return nextHeaders
}

export const request = ofetch.create({
  baseURL,
  headers,
  async onRequest(ctx) {
    const token = getAuthToken()
    if (token && ctx.options?.headers) {
      ;(ctx.options.headers as Headers).set("Authorization", `Bearer ${token}`)
    }
  },
  async onRequestError() {},
  async onResponse() {},
  async onResponseError() {},
})

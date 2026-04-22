import { ofetch } from "ofetch"

const defaultHeaders: HeadersInit = {
  Accept: "application/json",
  "Content-Type": "application/json",
}

const isElectron = !!(typeof window !== "undefined" && window.electronApi)

const server_url = `${import.meta.env.VITE_BACKEND_URL}:${import.meta.env.VITE_BACKEND_PORT}`

const fallbackBaseURL = isElectron
  ? server_url
  : import.meta.env.DEV
    ? "/actus"
    : server_url

let currentBaseURL = fallbackBaseURL

async function loadEndpointBaseURL(): Promise<string> {
  if (typeof window === "undefined") return fallbackBaseURL
  try {
    const endpoint = await window.electronApi?.getEndpoint()
    if (endpoint) {
      currentBaseURL = endpoint
      return endpoint
    }
  } catch {
    // ignore
  }
  return fallbackBaseURL
}

export function getRequestBaseUrl() {
  if (typeof window === "undefined") {
    return currentBaseURL || "http://localhost"
  }
  return new URL(currentBaseURL || "/", window.location.origin).toString()
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

export function updateRequestBaseUrl(url: string) {
  currentBaseURL = url
}

export const request = ofetch.create({
  baseURL: currentBaseURL,
  headers: { ...defaultHeaders },
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
      localStorage.removeItem("token")
      await window.electronApi?.clearAuth()
      if (typeof window !== "undefined") {
        window.location.hash = "#/login"
      }
    }
  },
})

if (typeof window !== "undefined") {
  loadEndpointBaseURL().then((url) => {
    // request.options.baseURL = url
  })
}

import { ofetch } from "ofetch"

const defaultHeaders: HeadersInit = {
  Accept: "application/json",
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
    const res = await ofetch<{
      data?: { config_value?: string }
    }>("/config-kvs/REMOTE_API_BASE_URL", {
      baseURL: fallbackBaseURL,
      headers: { ...defaultHeaders },
    })
    const endpoint = res?.data?.config_value
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
    const headers = new Headers(ctx.options?.headers)
    const token = getAuthToken()
    if (token) {
      headers.set("token", `${token}`)
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
